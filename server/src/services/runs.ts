import { db } from "@quantdesk/db";
import { runLogs, runs } from "@quantdesk/db/schema";
import { eq } from "drizzle-orm";
import { assignBaseline, validateGoLive, validateStop } from "./logic.js";

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

export async function goLive(runId: string) {
	const run = await getRun(runId);
	if (!run) throw new Error("Run not found");
	validateGoLive({ status: run.status, mode: run.mode });

	const [liveRun] = await db
		.insert(runs)
		.values({
			experimentId: run.experimentId,
			runNumber: run.runNumber,
			isBaseline: false,
			mode: "live",
			status: "running",
			config: run.config as Record<string, unknown>,
			commitHash: run.commitHash,
		})
		.returning();

	return liveRun!;
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
