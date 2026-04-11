import { db } from "@quantdesk/db";
import { agentTurns, comments, experiments, paperSessions, runs } from "@quantdesk/db/schema";
import { listByLabel } from "@quantdesk/engines/docker";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { publishExperimentEvent } from "../realtime/live-events.js";
import { systemComment } from "./comments.js";
import { attachLogStreamForReconcile, failSessionInternal } from "./paper-sessions.js";

/**
 * Boot-time reconcile policy: any `agent_turns` row left in `running`
 * at startup belongs to a child CLI subprocess from the previous
 * server process. Even if the child is technically still alive
 * (tsx-watch killed the parent, child reparented to init), it has
 * already lost its stdout pipe, its MCP HTTP server, and its
 * `activeAgents` registration — it cannot produce any useful work.
 *
 * The previous implementation tried to be optimistic about
 * "recent heartbeat = child is fine", which caused reconcile to skip
 * these turns; the heartbeat watchdog would then catch them 30-90s
 * later and surface a misleading "heartbeat timeout" message. The
 * honest answer is "the server restarted", so we mark all running
 * turns failed immediately at boot with `server_restart`.
 */

/**
 * Clean up stale agent runs on server startup.
 *
 * If the server crashed or was restarted mid-run, the in-memory agent process
 * is gone but the UI still thinks an agent is working (because the last comment
 * is from user/system and no agent response was ever posted).
 *
 * This scans active experiments and, for any where the last comment is from
 * user/system (awaiting agent reply), posts an "interrupted" system comment so
 * the UI exits the thinking state on next refresh.
 */
export async function cleanupStaleAgentRuns(): Promise<void> {
	try {
		const activeExperiments = await db
			.select()
			.from(experiments)
			.where(eq(experiments.status, "active"));

		let cleaned = 0;

		for (const exp of activeExperiments) {
			const expComments = await db
				.select()
				.from(comments)
				.where(eq(comments.experimentId, exp.id))
				.orderBy(comments.createdAt);

			const last = expComments[expComments.length - 1];
			if (!last) continue;

			// If last comment is from user/system, an agent run was pending
			if (last.author === "user" || last.author === "system") {
				// Avoid duplicate cleanup messages — skip if last message already says interrupted
				if (last.content.includes("interrupted")) continue;

				await systemComment({
					experimentId: exp.id,
					nextAction: "action",
					content:
						"Agent turn interrupted by a server restart. Reply with a new instruction to retry.",
				});
				cleaned += 1;
			}
		}

		if (cleaned > 0) {
			console.log(`[startup] Cleaned up ${cleaned} stale agent run(s)`);
		}
	} catch (err) {
		console.error("[startup] Failed to clean up stale agent runs:", err);
	}
}

/**
 * Phase 27 — Boot reconcile for `agent_turns`. Any row left in `running` at
 * startup belongs to a CLI subprocess that died with the server. Mark them
 * `failed` with `failure_reason='server_restart'` so the UI can render the
 * TurnCard in a terminal state. The rule #12 system comment for the owning
 * experiment is already handled by `cleanupStaleAgentRuns` above.
 */
export async function reconcileOrphanAgentTurns(): Promise<void> {
	try {
		// Every row still in `running` or `awaiting_validation` at boot
		// belongs to a subprocess from the previous server process — see
		// the module header for why we don't try to preserve them.
		// `awaiting_validation` turns had an RM dispatch in-flight that
		// died with the server; leaving them blocks future analyst triggers.
		const toMark = await db
			.select()
			.from(agentTurns)
			.where(
				and(
					inArray(agentTurns.status, ["running", "awaiting_validation"]),
					isNull(agentTurns.endedAt),
				),
			);
		for (const row of toMark) {
			await db
				.update(agentTurns)
				.set({
					status: "failed",
					endedAt: new Date(),
					failureReason: "server_restart",
				})
				.where(eq(agentTurns.id, row.id));
			// Notify any WS client still holding a stream open from before
			// the restart so the TurnCard exits the spinner immediately
			// instead of waiting on the heartbeat watchdog.
			publishExperimentEvent({
				experimentId: row.experimentId,
				type: "turn.status",
				payload: {
					turnId: row.id,
					status: "failed",
					failureReason: "server_restart",
				},
			});
		}
		if (toMark.length > 0) {
			console.log(`[startup] Reconciled ${toMark.length} orphan agent_turns row(s)`);
		}

		// Cascade to backtest runs reserved inside those dead turns. The MCP
		// `run_backtest` tool inserts a row in `running` before awaiting the
		// engine adapter; if the server died mid-call (tsx-watch dev restart,
		// crash, SIGTERM) the adapter's catch never executed, leaving a
		// phantom running run. Mark them failed so the UI exits the spinner.
		if (toMark.length > 0) {
			const orphanRuns = await db
				.update(runs)
				.set({
					status: "failed",
					error: "server_restart",
					completedAt: new Date(),
				})
				.where(
					and(
						eq(runs.status, "running"),
						eq(runs.mode, "backtest"),
						inArray(
							runs.turnId,
							toMark.map((t) => t.id),
						),
					),
				)
				.returning({ id: runs.id, experimentId: runs.experimentId });
			for (const r of orphanRuns) {
				publishExperimentEvent({
					experimentId: r.experimentId,
					type: "run.status",
					payload: { runId: r.id, status: "failed", error: "server_restart" },
				});
			}
			if (orphanRuns.length > 0) {
				console.log(`[startup] Reconciled ${orphanRuns.length} orphan backtest run(s)`);
			}
		}
	} catch (err) {
		console.error("[startup] Failed to reconcile orphan agent_turns:", err);
	}
}

/**
 * Boot reconcile for paper trading sessions. Docker is the source of
 * truth: if a container is alive, the session continues; if it's gone,
 * the DB row is marked `failed`. This runs once at startup.
 *
 * Three cases:
 *   1. DB=running + container alive → keep running (no-op).
 *   2. DB=running + container gone  → mark failed, post system comment.
 *   3. Container alive + no DB row  → orphan, stop+remove it.
 */
export async function reconcilePaperSessions(): Promise<void> {
	try {
		// 1. Get live paper containers from Docker.
		let liveContainers: Awaited<ReturnType<typeof listByLabel>>;
		try {
			liveContainers = await listByLabel("quantdesk.kind=paper");
		} catch {
			// Docker not available — can't reconcile. Skip silently; the
			// paper status polling (if enabled) will detect dead containers.
			return;
		}
		// Only truly running containers count as "alive". Exited containers
		// should not keep a DB session in "running" state (issue #4).
		const runningContainers = liveContainers.filter((c) => c.state === "running");
		const liveNames = new Set(runningContainers.map((c) => c.name));

		// Remove exited/dead paper containers (they won't restart).
		const exitedContainers = liveContainers.filter((c) => c.state !== "running");
		if (exitedContainers.length > 0) {
			const { removeContainer } = await import("@quantdesk/engines/docker");
			for (const c of exitedContainers) {
				try {
					await removeContainer(c.name);
				} catch {
					/* already gone */
				}
			}
			console.log(`[startup] Cleaned ${exitedContainers.length} exited paper container(s)`);
		}

		// 2. Get DB sessions that claim to be running.
		const dbRunning = await db
			.select()
			.from(paperSessions)
			.where(eq(paperSessions.status, "running"));

		let reconciled = 0;
		let kept = 0;

		for (const session of dbRunning) {
			if (session.containerName && liveNames.has(session.containerName)) {
				// Case 1: container is alive — keep it, and re-attach the
				// freqtrade log tail so the user sees live output again
				// after the server restart (the previous tail subprocess
				// died with the old server process).
				liveNames.delete(session.containerName);
				attachLogStreamForReconcile({
					sessionId: session.id,
					experimentId: session.experimentId,
					containerName: session.containerName,
				});
				kept++;
			} else {
				// Case 2: container vanished — mark failed.
				await failSessionInternal(
					session.id,
					session.experimentId,
					"container_vanished_during_downtime",
				);
				await systemComment({
					experimentId: session.experimentId,
					nextAction: "action",
					content:
						"Paper trading session ended unexpectedly — the container was not found after a server restart. Reply with a new instruction to investigate or start a new session.",
				});
				publishExperimentEvent({
					experimentId: session.experimentId,
					type: "paper.status",
					payload: { sessionId: session.id, status: "failed" },
				});
				reconciled++;
			}
		}

		// Case 3: orphan containers with no matching DB row.
		// liveNames still has containers that weren't matched above.
		if (liveNames.size > 0) {
			const { stopContainer, removeContainer } = await import("@quantdesk/engines/docker");
			for (const name of liveNames) {
				try {
					await stopContainer(name, 10);
					await removeContainer(name);
				} catch {
					// Already dead or permissions issue — not critical.
				}
			}
			console.log(`[startup] Removed ${liveNames.size} orphan paper container(s)`);
		}

		if (reconciled > 0) {
			console.log(`[startup] Reconciled ${reconciled} dead paper session(s)`);
		}
		if (kept > 0) {
			console.log(`[startup] Kept ${kept} live paper session(s)`);
		}
	} catch (err) {
		console.error("[startup] Failed to reconcile paper sessions:", err);
	}
}

/**
 * Kill any `run_script` containers that survived a previous server
 * process. Scripts are synchronous (the server process awaits the
 * container), so any script container still alive at boot is
 * guaranteed to be orphaned — either the server crashed mid-runScript
 * or the script is in an infinite loop the previous process was
 * waiting on. Either way, nothing is reading its stdout anymore and
 * it's burning CPU for no reason.
 *
 * This was motivated by the hyperliquid BTC/USDT retry-loop incident:
 * an agent-authored fetcher script hit a permanent error on the wrong
 * symbol, retried forever, and the containers were still running two
 * days later after many server restarts.
 */
export async function reconcileOrphanScriptContainers(): Promise<void> {
	try {
		let scriptContainers: Awaited<ReturnType<typeof listByLabel>>;
		try {
			scriptContainers = await listByLabel("quantdesk.kind=script");
		} catch {
			// Docker not available — can't reconcile. Skip silently.
			return;
		}
		if (scriptContainers.length === 0) return;

		const { stopContainer, removeContainer } = await import("@quantdesk/engines/docker");
		let killed = 0;
		for (const c of scriptContainers) {
			try {
				await stopContainer(c.name, 5);
			} catch {
				/* already dead */
			}
			try {
				await removeContainer(c.name);
			} catch {
				/* already gone (rm:true auto-removed) */
			}
			killed++;
		}
		if (killed > 0) {
			console.log(`[startup] Killed ${killed} orphan script container(s)`);
		}
	} catch (err) {
		console.error("[startup] Failed to reconcile orphan script containers:", err);
	}
}
