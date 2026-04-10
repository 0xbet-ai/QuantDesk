import { db } from "@quantdesk/db";
import { desks, experiments, runLogs, runs } from "@quantdesk/db/schema";
import { getAdapter as getEngineAdapter } from "@quantdesk/engines";
import { eq } from "drizzle-orm";
import { publishExperimentEvent } from "../realtime/live-events.js";
import { assignBaseline, validateGoPaper, validateStop } from "./logic.js";
import {
	failSession,
	markSessionRunning,
	startPaperSession,
} from "./paper-sessions.js";

interface Metric {
	key: string;
	label: string;
	value: number;
	format: "percent" | "number" | "integer" | "currency";
	tone?: "positive" | "negative" | "neutral";
}

/** Convert legacy {returnPct, drawdownPct, ...} into {metrics: [...]} */
function normalizeResult(result: unknown): { metrics: Metric[] } | null {
	if (!result || typeof result !== "object") return null;
	const r = result as Record<string, unknown>;
	if (Array.isArray(r.metrics)) return { metrics: r.metrics as Metric[] };

	const metrics: Metric[] = [];
	if (typeof r.returnPct === "number") {
		metrics.push({
			key: "return",
			label: "Return",
			value: r.returnPct,
			format: "percent",
			tone: "positive",
		});
	}
	if (typeof r.drawdownPct === "number") {
		metrics.push({
			key: "drawdown",
			label: "Max Drawdown",
			value: r.drawdownPct,
			format: "percent",
			tone: "negative",
		});
	}
	if (typeof r.winRate === "number") {
		metrics.push({
			key: "win_rate",
			label: "Win Rate",
			value: r.winRate,
			format: "percent",
		});
	}
	if (typeof r.totalTrades === "number") {
		metrics.push({
			key: "trades",
			label: "Trades",
			value: r.totalTrades,
			format: "integer",
		});
	}
	return metrics.length > 0 ? { metrics } : null;
}

function normalizeRun<T extends { result: unknown }>(run: T): T {
	return { ...run, result: normalizeResult(run.result) } as T;
}

interface CreateRunInput {
	experimentId: string;
	mode: string;
	config?: Record<string, unknown>;
	datasetId?: string;
}

export async function createRun(input: CreateRunInput) {
	const existing = await db.select().from(runs).where(eq(runs.experimentId, input.experimentId));

	const isBaseline = assignBaseline(existing.length);
	const runNumber = existing.length + 1;

	const [run] = await db
		.insert(runs)
		.values({
			experimentId: input.experimentId,
			runNumber,
			isBaseline,
			mode: input.mode,
			config: input.config ?? {},
			datasetId: input.datasetId ?? null,
		})
		.returning();

	return run!;
}

export async function listRuns(experimentId: string) {
	const rows = await db
		.select()
		.from(runs)
		.where(eq(runs.experimentId, experimentId))
		.orderBy(runs.runNumber);
	return rows.map(normalizeRun);
}

export async function getRun(id: string) {
	const [run] = await db.select().from(runs).where(eq(runs.id, id));
	return run ? normalizeRun(run) : null;
}

export async function goPaper(runId: string) {
	const run = await getRun(runId);
	if (!run) throw new Error("Run not found");
	validateGoPaper({ status: run.status, mode: run.mode });

	// Resolve experiment → desk.
	const [experiment] = await db
		.select()
		.from(experiments)
		.where(eq(experiments.id, run.experimentId));
	if (!experiment) throw new Error("Experiment not found");
	const [desk] = await db
		.select()
		.from(desks)
		.where(eq(desks.id, experiment.deskId));
	if (!desk || !desk.workspacePath) throw new Error("Desk not found or no workspace");

	// 1. Create paper session (validates: verdict=approve, one-per-desk).
	const session = await startPaperSession({
		runId,
		deskId: desk.id,
		experimentId: experiment.id,
	});

	// 2. Spawn the engine's dry-run container.
	const engineAdapter = getEngineAdapter(desk.engine);
	const venue = (desk.venues as string[])[0] ?? "binance";
	const runConfig = run.config as Record<string, unknown> | null;

	// Read pairs from the workspace config.json (the agent wrote it
	// during backtest setup and it has the correct venue-specific pair
	// format, e.g. "BTC/USDC:USDC" for Hyperliquid perps).
	let wsPairs: string[] | null = null;
	let wsTimeframe: string | null = null;
	try {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const wsConfig = JSON.parse(readFileSync(join(desk.workspacePath, "config.json"), "utf-8"));
		wsPairs = wsConfig?.exchange?.pair_whitelist ?? null;
		wsTimeframe = wsConfig?.timeframe ?? null;
	} catch { /* no config.json or unreadable */ }

	let handle: Awaited<ReturnType<typeof engineAdapter.startPaper>>;
	try {
		handle = await engineAdapter.startPaper({
			strategyPath: "strategy.py",
			runId,
			workspacePath: desk.workspacePath,
			exchange: venue,
			pairs: wsPairs ?? (runConfig?.pairs as string[]) ?? ["BTC/USDT"],
			timeframe: wsTimeframe ?? (runConfig?.timeframe as string) ?? "5m",
			wallet: Number(desk.budget) || 10000,
			extraVolumes: (desk.externalMounts ?? []).map(
				(m) => `${m.hostPath}:/workspace/data/external/${m.label}:ro`,
			),
		});
	} catch (err) {
		await failSession(session.id, err instanceof Error ? err.message : "spawn failed");
		throw err;
	}

	// 3. Mark session running.
	await markSessionRunning(session.id, {
		containerName: handle.containerName,
		apiPort: handle.meta?.apiPort as number | undefined,
		meta: handle.meta ?? undefined,
	});

	publishExperimentEvent({
		experimentId: experiment.id,
		type: "paper.status",
		payload: { sessionId: session.id, status: "running" },
	});

	// 4. Create a paper runs row for UI display.
	const [paperRun] = await db
		.insert(runs)
		.values({
			experimentId: run.experimentId,
			runNumber: run.runNumber,
			isBaseline: false,
			mode: "paper",
			status: "running",
			config: run.config as Record<string, unknown>,
			commitHash: run.commitHash,
		})
		.returning();

	return paperRun!;
}

export async function stopRun(runId: string) {
	const run = await getRun(runId);
	if (!run) throw new Error("Run not found");
	validateStop({ status: run.status, mode: run.mode });

	const [stopped] = await db
		.update(runs)
		.set({ status: "stopped", completedAt: new Date() })
		.where(eq(runs.id, runId))
		.returning();

	return stopped!;
}

export async function getRunStatus(runId: string) {
	const run = await getRun(runId);
	if (!run) throw new Error("Run not found");
	return { status: run.status, mode: run.mode, result: run.result };
}

export async function listRunLogs(runId: string) {
	return db.select().from(runLogs).where(eq(runLogs.runId, runId)).orderBy(runLogs.createdAt);
}
