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
import {
	type LogStreamHandle,
	followLogs,
	getAdapter as getEngineAdapter,
} from "@quantdesk/engines";
import { and, desc, eq, inArray } from "drizzle-orm";
import { publishExperimentEvent } from "../realtime/live-events.js";
import { appendAgentLog } from "./agent-log.js";
import { systemComment } from "./comments.js";

export class PaperSessionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PaperSessionError";
	}
}

// ── Log streaming registry ─────────────────────────────────────────
//
// One tail subprocess per running paper session, keyed by sessionId.
// Populated by startPaper / reconcilePaperSessions and drained by
// stopPaper / failSessionInternal. Kept in-memory because tails don't
// survive a server restart anyway — the boot reconcile re-attaches them
// for every session it finds still running.
//
// Rationale: freqtrade writes critical signals (entry/exit RPC messages,
// "Bot heartbeat", "Pair X not compatible" warnings, ccxt errors) to
// stdout. Without this tail the user stares at a silent "running" badge
// and has no way to tell a healthy bot from a zombie one — exactly the
// failure mode that masked the BTC/USDT venue-mismatch bug for a full
// day of paper trading.
const paperLogStreams = new Map<string, LogStreamHandle>();

/**
 * Attach a `docker logs -f` tail to a running paper container and
 * forward each line as a `paper.log` WebSocket event. Safe to call
 * multiple times — the previous handle (if any) is stopped first so
 * we never end up with duplicated output.
 */
function attachPaperLogStream(params: {
	sessionId: string;
	experimentId: string;
	containerName: string;
}): void {
	const { sessionId, experimentId, containerName } = params;
	// Tear down any leftover tail from a previous attach.
	const prev = paperLogStreams.get(sessionId);
	if (prev) {
		prev.stop();
		paperLogStreams.delete(sessionId);
	}

	const emitLine = (stream: "stdout" | "stderr", line: string) => {
		publishExperimentEvent({
			experimentId,
			type: "paper.log",
			payload: { sessionId, stream, line },
		});
		// Also persist into the experiment's agent log so the next
		// agent turn can read "new since your last turn" and react to
		// container errors without a separate tool call.
		appendAgentLog(experimentId, {
			ts: new Date().toISOString(),
			type: stream === "stderr" ? "stderr" : "stdout",
			content: line,
		});
	};

	const handle = followLogs(containerName, {
		tail: 0, // live only — don't re-emit history on every reconnect
		onStdoutLine: (line) => emitLine("stdout", line),
		onStderrLine: (line) => emitLine("stderr", line),
		onExit: (code) => {
			paperLogStreams.delete(sessionId);
			if (code !== 0) {
				emitLine("stderr", `[quantdesk] docker logs -f exited with code ${code} — tail detached`);
			}
		},
	});
	paperLogStreams.set(sessionId, handle);
}

function detachPaperLogStream(sessionId: string): void {
	const handle = paperLogStreams.get(sessionId);
	if (!handle) return;
	handle.stop();
	paperLogStreams.delete(sessionId);
}

// ── Market tick registry ───────────────────────────────────────────
//
// One setInterval handle per running paper session. Every MARKET_TICK_MS
// we ask the engine adapter for a one-line "current price + indicators"
// summary and publish it onto the paper.log stream. Without this the
// only live signal the user sees is "Bot heartbeat. state='RUNNING'"
// once a minute — which proves the process is alive but NOT that it's
// actually processing market data. A fresh close price every 30s is
// the cheapest possible "yes, data is flowing" indicator.
const paperMarketTickers = new Map<string, ReturnType<typeof setInterval>>();
// 5-second cadence: freqtrade updates its in-memory forming candle as
// new ticks arrive from the exchange, so even in the middle of a 5m
// candle the close price can move. A 5s tick makes the log feel "live"
// without hammering freqtrade's REST API (the endpoint returns a tiny
// 1-row payload, so ~200 QPH per paper session is negligible).
const MARKET_TICK_MS = 5_000;

/**
 * Start periodic market ticks for a running paper session. The ticks
 * are emitted as synthetic lines on the same paper.log stream the
 * freqtrade container writes to, so the UI log panel shows them inline
 * with heartbeats / signals / errors.
 *
 * No-op if the engine adapter doesn't implement `getPaperMarketTickLine`
 * (generic engine has no notion of "current market state").
 */
function attachPaperMarketTicker(params: {
	sessionId: string;
	experimentId: string;
	engine: string;
	handle: { containerName: string; runId: string; meta: Record<string, unknown> };
	pair: string;
	timeframe: string;
}): void {
	const adapter = getEngineAdapter(params.engine);
	if (typeof adapter.getPaperMarketTickLine !== "function") return;

	// Tear down any leftover ticker from a previous attach (e.g. a boot
	// reconcile after a session was already running).
	const prev = paperMarketTickers.get(params.sessionId);
	if (prev) clearInterval(prev);

	const tick = async () => {
		try {
			const line = await adapter.getPaperMarketTickLine!(
				params.handle,
				params.pair,
				params.timeframe,
			);
			if (!line) return;
			publishExperimentEvent({
				experimentId: params.experimentId,
				type: "paper.log",
				payload: { sessionId: params.sessionId, stream: "stdout", line },
			});
			appendAgentLog(params.experimentId, {
				ts: new Date().toISOString(),
				type: "stdout",
				content: line,
			});
		} catch {
			// Best-effort — a transient fetch failure shouldn't kill the
			// interval. The next tick will retry.
		}
	};

	// Fire once immediately so the user sees a price line the moment
	// the log panel mounts, then every MARKET_TICK_MS after that.
	void tick();
	const interval = setInterval(tick, MARKET_TICK_MS);
	paperMarketTickers.set(params.sessionId, interval);
}

function detachPaperMarketTicker(sessionId: string): void {
	const id = paperMarketTickers.get(sessionId);
	if (!id) return;
	clearInterval(id);
	paperMarketTickers.delete(sessionId);
}

/**
 * Public hook for the boot reconcile (`startup-cleanup.ts`) to re-attach
 * the log tail AND market ticker for a paper session that survived a
 * server restart. The previous tail subprocess died with the parent
 * server process, so without this the user would never see any more
 * stdout (or market ticks) from a container that kept running across
 * a restart.
 */
export function attachLogStreamForReconcile(params: {
	sessionId: string;
	experimentId: string;
	containerName: string;
	engine?: string;
	runId?: string;
	apiPort?: number | null;
	meta?: Record<string, unknown> | null;
	pair?: string | null;
	timeframe?: string | null;
}): void {
	attachPaperLogStream({
		sessionId: params.sessionId,
		experimentId: params.experimentId,
		containerName: params.containerName,
	});
	if (
		params.engine &&
		params.runId &&
		params.pair &&
		params.timeframe &&
		params.meta &&
		typeof (params.meta as Record<string, unknown>).apiUrl === "string"
	) {
		attachPaperMarketTicker({
			sessionId: params.sessionId,
			experimentId: params.experimentId,
			engine: params.engine,
			handle: {
				containerName: params.containerName,
				runId: params.runId,
				meta: params.meta as Record<string, unknown>,
			},
			pair: params.pair,
			timeframe: params.timeframe,
		});
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
		const wsConfig = JSON.parse(readFileSync(join(desk.workspacePath, "config.json"), "utf-8"));
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
		const msg = err instanceof Error ? err.message : String(err);
		await failSessionInternal(sessionId, experiment.id, msg);
		// Surface the failure to the agent as a rule #12 system comment
		// so the next analyst turn sees "why" and can self-heal (fix
		// config.json, retry, or escalate to the user). Without this,
		// a failed paper start is silent — the agent just sees a
		// vanished session row on its next fetch.
		try {
			await systemComment({
				experimentId: experiment.id,
				nextAction: "action",
				content: `Paper trading failed to start: ${msg} Reply with how you want to proceed (fix config.json and retry, pick a different run, or investigate the container logs).`,
			});
		} catch {
			/* best effort — never let comment failure mask the real error */
		}
		throw new PaperSessionError(`Container spawn failed: ${msg}`);
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
		} catch {
			/* best effort */
		}
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

	// 10. Attach the freqtrade log tail so every line (heartbeat, entry
	//     signals, errors, ccxt warnings) reaches the UI in real time.
	attachPaperLogStream({
		sessionId,
		experimentId: experiment.id,
		containerName: handle.containerName,
	});
	// 11. Attach the periodic market tick so the log panel shows a live
	//     "close=..., adx=..., signal=..." summary every 30 seconds even
	//     when freqtrade itself has nothing to say. This is the cheapest
	//     proof that the bot is actually processing market data instead
	//     of sitting idle on a stopped state.
	attachPaperMarketTicker({
		sessionId,
		experimentId: experiment.id,
		engine: desk.engine,
		handle: {
			containerName: handle.containerName,
			runId: handle.runId,
			meta: (handle.meta ?? {}) as Record<string, unknown>,
		},
		pair: pairs[0]!,
		timeframe,
	});

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

	// 2. Detach the log tail + market ticker — the container is gone
	//    or will be shortly.
	detachPaperLogStream(session.id);
	detachPaperMarketTicker(session.id);

	// 3. Mark session stopped + mark paper runs stopped.
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

	// 4. Publish to the SESSION's experiment, not the caller's.
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
	// Detach log tail + market ticker — the container is dead or about to be.
	detachPaperLogStream(sessionId);
	detachPaperMarketTicker(sessionId);

	await db
		.update(paperSessions)
		.set({ status: "failed", stoppedAt: new Date(), error })
		.where(eq(paperSessions.id, sessionId));

	// Also fail any paper runs for this experiment (issue #5 fix).
	await db
		.update(runs)
		.set({ status: "failed", error, completedAt: new Date() })
		.where(
			and(eq(runs.experimentId, experimentId), eq(runs.mode, "paper"), eq(runs.status, "running")),
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
			and(eq(paperSessions.deskId, deskId), inArray(paperSessions.status, ["running", "pending"])),
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

export async function listRunningSessions(): Promise<Array<typeof paperSessions.$inferSelect>> {
	return db.select().from(paperSessions).where(eq(paperSessions.status, "running"));
}
