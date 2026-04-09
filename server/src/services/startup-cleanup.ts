import { db } from "@quantdesk/db";
import { agentTurns, comments, experiments, runs } from "@quantdesk/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { publishExperimentEvent } from "../realtime/live-events.js";
import { systemComment } from "./comments.js";

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
		// Every row still in `running` at boot belongs to a subprocess
		// from the previous server process — see the module header for
		// why we don't try to preserve "fresh heartbeat" turns.
		const toMark = await db
			.select()
			.from(agentTurns)
			.where(and(eq(agentTurns.status, "running"), isNull(agentTurns.endedAt)));
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
