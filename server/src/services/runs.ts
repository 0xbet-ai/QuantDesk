import { db } from "@quantdesk/db";
import { runLogs, runs } from "@quantdesk/db/schema";
import { eq } from "drizzle-orm";
import { assignBaseline, validateGoLive, validateStop } from "./logic.js";

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
	return db.select().from(runs).where(eq(runs.experimentId, experimentId)).orderBy(runs.runNumber);
}

export async function getRun(id: string) {
	const [run] = await db.select().from(runs).where(eq(runs.id, id));
	return run ?? null;
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
