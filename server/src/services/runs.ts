import { db } from "@quantdesk/db";
import { runLogs, runs } from "@quantdesk/db/schema";
import { eq } from "drizzle-orm";
import { assignBaseline, validateStop } from "./logic.js";
import { startPaper } from "./paper-sessions.js";

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
	const normalized = normalizeResult(run.result);
	// Preserve validation field from the original result so the UI
	// can show approved/rejected status on paper trading cards.
	const raw = run.result as Record<string, unknown> | null;
	const validation = raw?.validation;
	const result = normalized
		? validation
			? { ...normalized, validation }
			: normalized
		: null;
	return { ...run, result } as T;
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
	// Thin wrapper — all logic lives in paper-sessions.ts:startPaper().
	return startPaper(runId);
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
