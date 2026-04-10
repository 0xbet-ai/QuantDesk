/**
 * Paper trading session service — promotion gates, lifecycle, queries.
 *
 * Business rules:
 *  - Source run must have a validation verdict of "approve".
 *  - One running paper session per desk at a time.
 *  - No auto-restart: a failed session stays failed until the user
 *    explicitly promotes a new run.
 *
 * This module is pure DB + business logic. Docker / engine adapter
 * calls live in the MCP handler (`server.ts`) or the reconcile
 * module — not here.
 */

import { db } from "@quantdesk/db";
import { desks, experiments, paperSessions, runs } from "@quantdesk/db/schema";
import { desc, eq } from "drizzle-orm";

export class PaperSessionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PaperSessionError";
	}
}

/**
 * Validate promotion gates and create a `pending` paper session row.
 * Returns the new session row. Throws `PaperSessionError` on any
 * precondition failure.
 */
export async function startPaperSession(input: {
	runId: string;
	deskId: string;
	experimentId: string;
}): Promise<typeof paperSessions.$inferSelect> {
	// 1. Run must exist and belong to this desk via its experiment.
	const [run] = await db.select().from(runs).where(eq(runs.id, input.runId));
	if (!run) throw new PaperSessionError("Run not found.");

	const [experiment] = await db
		.select()
		.from(experiments)
		.where(eq(experiments.id, run.experimentId));
	if (!experiment || experiment.deskId !== input.deskId) {
		throw new PaperSessionError("Run does not belong to this desk.");
	}

	// 2. Run must have a validation verdict of "approve".
	// Root cause: paper approval has to stay attached to `input.runId`;
	// re-checking any newer run would let an unrelated RM approval leak
	// across runs.
	const result = run.result as Record<string, unknown> | null;
	const validation = result?.validation as { verdict: string } | undefined;
	if (!validation || validation.verdict !== "approve") {
		throw new PaperSessionError(
			"Run has not been validated (approve). Request validation from the Risk Manager first.",
		);
	}

	// 3. Desk must not already have a running/pending session.
	const active = await getActiveSession(input.deskId);
	if (active) {
		throw new PaperSessionError(
			`Desk already has an active paper session (${active.status}). Stop it before starting a new one.`,
		);
	}

	// 4. Resolve engine from desk.
	const [desk] = await db
		.select({ engine: desks.engine })
		.from(desks)
		.where(eq(desks.id, input.deskId));
	if (!desk) throw new PaperSessionError("Desk not found.");

	// 5. Create the session row.
	const [session] = await db
		.insert(paperSessions)
		.values({
			deskId: input.deskId,
			runId: input.runId,
			experimentId: input.experimentId,
			engine: desk.engine,
			status: "pending",
		})
		.returning();

	return session!;
}

/**
 * Transition a session to `running` after the container is up.
 */
export async function markSessionRunning(
	sessionId: string,
	containerInfo: { containerName: string; apiPort?: number; meta?: Record<string, unknown> },
): Promise<void> {
	await db
		.update(paperSessions)
		.set({
			status: "running",
			containerName: containerInfo.containerName,
			apiPort: containerInfo.apiPort ?? null,
			meta: containerInfo.meta ?? null,
		})
		.where(eq(paperSessions.id, sessionId));
}

/**
 * Stop a session. Caller is responsible for actually stopping the
 * container before calling this.
 */
export async function stopSession(sessionId: string): Promise<void> {
	await db
		.update(paperSessions)
		.set({
			status: "stopped",
			stoppedAt: new Date(),
		})
		.where(eq(paperSessions.id, sessionId));
}

/**
 * Mark a session as failed with an error reason.
 */
export async function failSession(sessionId: string, error: string): Promise<void> {
	await db
		.update(paperSessions)
		.set({
			status: "failed",
			stoppedAt: new Date(),
			error,
		})
		.where(eq(paperSessions.id, sessionId));
}

/**
 * Get the currently active (pending | running) paper session for a
 * desk, if any.
 */
export async function getActiveSession(
	deskId: string,
): Promise<typeof paperSessions.$inferSelect | null> {
	const rows = await db.select().from(paperSessions).where(eq(paperSessions.deskId, deskId));
	return rows.find((r) => r.status === "running" || r.status === "pending") ?? null;
}

/**
 * Get the most recent paper session for a desk (any status).
 */
export async function getLatestSession(
	deskId: string,
): Promise<typeof paperSessions.$inferSelect | null> {
	const [row] = await db
		.select()
		.from(paperSessions)
		.where(eq(paperSessions.deskId, deskId))
		.orderBy(desc(paperSessions.startedAt))
		.limit(1);
	return row ?? null;
}

/**
 * Get a specific session by id.
 */
export async function getSession(
	sessionId: string,
): Promise<typeof paperSessions.$inferSelect | null> {
	const [row] = await db.select().from(paperSessions).where(eq(paperSessions.id, sessionId));
	return row ?? null;
}

/**
 * List all sessions that the DB thinks are running. Used by boot
 * reconcile to cross-check against live Docker containers.
 */
export async function listRunningSessions(): Promise<Array<typeof paperSessions.$inferSelect>> {
	return db.select().from(paperSessions).where(eq(paperSessions.status, "running"));
}
