/**
 * Paper trading lifecycle service — the single owner of paper session
 * state transitions. All callers (MCP tool, REST route, reconcile) go
 * through this module so error handling, container management, and DB
 * updates are consistent.
 *
 * Business rules:
 *  - Source run must be a completed backtest. Risk Manager verdict
 *    (approve/reject) is informational metadata, NOT a hard gate —
 *    the operator has the final call. The UI surfaces a confirm step
 *    when the verdict is reject.
 *  - One running paper session per desk at a time (enforced by
 *    select-for-update before insert).
 *  - No auto-restart: a failed session stays failed until the user
 *    explicitly promotes a new run.
 *  - Container lifecycle is atomic with DB state: if the container
 *    fails to start, the session is failed. If the container fails
 *    to stop, the session is NOT marked stopped.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "@quantdesk/db";
import { desks, experiments, paperSessions, runs } from "@quantdesk/db/schema";
import { getAdapter as getEngineAdapter } from "@quantdesk/engines";
import { and, desc, eq, inArray } from "drizzle-orm";
import { publishExperimentEvent } from "../realtime/live-events.js";

export class PaperSessionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PaperSessionError";
	}
}

// ── Full lifecycle: start ────────────────────────────────────────────

/**
 * Validate gates, create session, spawn container, mark running —
 * all in one atomic-ish flow. If any step fails after the session row
 * is created, the session is marked `failed` and the container (if
 * spawned) is cleaned up. Returns the paper `runs` row for the UI.
 */
export async function startPaper(runId: string) {
	// 1. Load and validate the run.
	const [run] = await db.select().from(runs).where(eq(runs.id, runId));
	if (!run) throw new PaperSessionError("Run not found.");
	if (run.status !== "completed" || run.mode !== "backtest") {
		throw new PaperSessionError("Can only paper-trade a completed backtest run.");
	}

	// RM verdict is no longer a hard gate — see module header. The operator
	// (or the agent, with prior consent) decides whether to proceed when
	// the verdict is reject. The verdict still lives in `run.result.validation`
	// as informational metadata for downstream consumers.

	// 2. Load experiment + desk.
	const [experiment] = await db
		.select()
		.from(experiments)
		.where(eq(experiments.id, run.experimentId));
	if (!experiment) throw new PaperSessionError("Experiment not found.");

	const [desk] = await db.select().from(desks).where(eq(desks.id, experiment.deskId));
	if (!desk || !desk.workspacePath) {
		throw new PaperSessionError("Desk not found or has no workspace.");
	}

	const venues = desk.venues as string[];
	if (!venues || venues.length === 0) {
		throw new PaperSessionError("Desk has no venues configured.");
	}
	const venue = venues[0]!;

	// 3. Read pairs + timeframe from workspace config.json. Fail loud.
	let pairs: string[];
	let timeframe: string;
	try {
		const wsConfig = JSON.parse(
			readFileSync(join(desk.workspacePath, "config.json"), "utf-8"),
		);
		pairs = wsConfig?.exchange?.pair_whitelist;
		timeframe = wsConfig?.timeframe;
	} catch {
		throw new PaperSessionError(
			"Paper trading requires config.json in the workspace with exchange.pair_whitelist and timeframe.",
		);
	}
	if (!Array.isArray(pairs) || pairs.length === 0) {
		throw new PaperSessionError(
			"config.json has no exchange.pair_whitelist. The agent must set pairs before paper trading.",
		);
	}
	if (!timeframe) {
		throw new PaperSessionError(
			"config.json has no timeframe. The agent must set a timeframe before paper trading.",
		);
	}

	// 4. Validate budget.
	const budget = Number(desk.budget);
	if (!Number.isFinite(budget) || budget <= 0) {
		throw new PaperSessionError(`Invalid desk budget: ${desk.budget}. Must be a positive number.`);
	}

	// 5. One-per-desk gate. Uses select + check (no DB constraint yet,
	//    but all callers funnel through this function so the window is
	//    small). A future improvement is a partial unique index.
	const active = await getActiveSession(desk.id);
	if (active) {
		throw new PaperSessionError(
			`Desk already has an active paper session (${active.status}). Stop it first.`,
		);
	}

	// 6. Create pending session row.
	const [session] = await db
		.insert(paperSessions)
		.values({
			deskId: desk.id,
			runId,
			experimentId: experiment.id,
			engine: desk.engine,
			status: "pending",
		})
		.returning();
	const sessionId = session!.id;

	// 7. Spawn container. If this fails, mark session failed + clean up.
	const engineAdapter = getEngineAdapter(desk.engine);
	let handle: Awaited<ReturnType<typeof engineAdapter.startPaper>>;
	try {
		handle = await engineAdapter.startPaper({
			strategyPath: "strategy.py",
			runId,
			workspacePath: desk.workspacePath,
			exchange: venue,
			pairs,
			timeframe,
			wallet: budget,
			extraVolumes: (desk.externalMounts ?? []).map(
				(m) => `${m.hostPath}:/workspace/data/external/${m.label}:ro`,
			),
		});
	} catch (err) {
		await failSessionInternal(sessionId, experiment.id, err instanceof Error ? err.message : "spawn failed");
		throw new PaperSessionError(`Container spawn failed: ${err instanceof Error ? err.message : String(err)}`);
	}

	// 8. Mark session running. If this fails, stop the container.
	try {
		await db
			.update(paperSessions)
			.set({
				status: "running",
				containerName: handle.containerName,
				apiPort: (handle.meta?.apiPort as number) ?? null,
				meta: { ...(handle.meta ?? {}), pairs, timeframe, venue },
			})
			.where(eq(paperSessions.id, sessionId));
	} catch (err) {
		// Kill the container we just spawned.
		try {
			await engineAdapter.stopPaper(handle);
		} catch { /* best effort */ }
		await failSessionInternal(sessionId, experiment.id, "failed to mark session running");
		throw err;
	}

	// 9. Create paper runs row for UI display.
	const [paperRun] = await db
		.insert(runs)
		.values({
			experimentId: run.experimentId,
			runNumber: run.runNumber,
			isBaseline: false,
			mode: "paper",
			status: "running",
			config: { pairs, timeframe, venue } satisfies Record<string, unknown>,
			commitHash: run.commitHash,
		})
		.returning();

	publishExperimentEvent({
		experimentId: experiment.id,
		type: "paper.status",
		payload: { sessionId, status: "running" },
	});

	return paperRun!;
}

// ── Full lifecycle: stop ─────────────────────────────────────────────

/**
 * Stop an active paper session. The container must be confirmed
 * stopped/removed before the DB is transitioned. If container
 * shutdown fails, the session stays running so reconcile can retry.
 */
export async function stopPaper(deskId: string): Promise<{ sessionId: string }> {
	const session = await getActiveSession(deskId);
	if (!session) throw new PaperSessionError("No active paper session on this desk.");

	// 1. Stop the container.
	const [desk] = await db.select().from(desks).where(eq(desks.id, deskId));
	if (desk && session.containerName) {
		const engineAdapter = getEngineAdapter(desk.engine);
		try {
			await engineAdapter.stopPaper({
				containerName: session.containerName,
				runId: session.runId,
				meta: (session.meta as Record<string, unknown>) ?? {},
			});
		} catch (err) {
			// Container might already be gone — verify before proceeding.
			// If we can't confirm it's gone, don't mark stopped.
			try {
				const { listByLabel } = await import("@quantdesk/engines/docker");
				const live = await listByLabel("quantdesk.kind=paper");
				const stillAlive = live.some(
					(c) => c.name === session.containerName && c.state === "running",
				);
				if (stillAlive) {
					throw new PaperSessionError(
						`Failed to stop container ${session.containerName}: ${err instanceof Error ? err.message : String(err)}`,
					);
				}
				// Container is gone — proceed to mark stopped.
			} catch (verifyErr) {
				if (verifyErr instanceof PaperSessionError) throw verifyErr;
				// Can't verify Docker state — leave session as-is.
				throw new PaperSessionError("Cannot verify container state after stop failure.");
			}
		}
	}

	// 2. Mark session stopped + mark paper runs stopped.
	await db
		.update(paperSessions)
		.set({ status: "stopped", stoppedAt: new Date() })
		.where(eq(paperSessions.id, session.id));

	await db
		.update(runs)
		.set({ status: "stopped", completedAt: new Date() })
		.where(
			and(
				eq(runs.experimentId, session.experimentId),
				eq(runs.mode, "paper"),
				eq(runs.status, "running"),
			),
		);

	// 3. Publish to the SESSION's experiment, not the caller's.
	publishExperimentEvent({
		experimentId: session.experimentId,
		type: "paper.status",
		payload: { sessionId: session.id, status: "stopped" },
	});

	return { sessionId: session.id };
}

// ── Internal helpers ─────────────────────────────────────────────────

/**
 * Mark a session as failed + cascade to paper runs. Used internally
 * by startPaper error paths and by reconcile.
 */
export async function failSessionInternal(
	sessionId: string,
	experimentId: string,
	error: string,
): Promise<void> {
	await db
		.update(paperSessions)
		.set({ status: "failed", stoppedAt: new Date(), error })
		.where(eq(paperSessions.id, sessionId));

	// Also fail any paper runs for this experiment (issue #5 fix).
	await db
		.update(runs)
		.set({ status: "failed", error, completedAt: new Date() })
		.where(
			and(
				eq(runs.experimentId, experimentId),
				eq(runs.mode, "paper"),
				eq(runs.status, "running"),
			),
		);
}

// ── Queries ──────────────────────────────────────────────────────────

export async function getActiveSession(
	deskId: string,
): Promise<typeof paperSessions.$inferSelect | null> {
	// Order by startedAt desc so we always get the most recent active
	// session if a race condition created duplicates.
	const [row] = await db
		.select()
		.from(paperSessions)
		.where(
			and(
				eq(paperSessions.deskId, deskId),
				inArray(paperSessions.status, ["running", "pending"]),
			),
		)
		.orderBy(desc(paperSessions.startedAt))
		.limit(1);
	return row ?? null;
}

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

export async function getSession(
	sessionId: string,
): Promise<typeof paperSessions.$inferSelect | null> {
	const [row] = await db.select().from(paperSessions).where(eq(paperSessions.id, sessionId));
	return row ?? null;
}

export async function listRunningSessions(): Promise<
	Array<typeof paperSessions.$inferSelect>
> {
	return db.select().from(paperSessions).where(eq(paperSessions.status, "running"));
}
