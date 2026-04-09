import { db } from "@quantdesk/db";
import { agentTurns, comments, experiments } from "@quantdesk/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { systemComment } from "./comments.js";

/** Heartbeat freshness threshold — if the turn's heartbeat was bumped
 *  within this window, the agent subprocess is assumed to still be alive
 *  (tsx-watch restarted the parent but the child is still streaming). */
const FRESH_HEARTBEAT_MS = 60 * 1000;

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

				// Dev-mode safety: tsx watch restarts the parent server on
				// every file save, but the spawned Claude CLI subprocess and
				// its docker children keep running. If the latest turn's
				// heartbeat was bumped within the last minute, assume the
				// agent is still alive and do NOT post the interrupted
				// message — otherwise we'd spam bogus failures on every
				// file save.
				const [latestTurn] = await db
					.select()
					.from(agentTurns)
					.where(eq(agentTurns.experimentId, exp.id))
					.orderBy(desc(agentTurns.startedAt))
					.limit(1);
				if (latestTurn && latestTurn.status === "running") {
					const age = Date.now() - new Date(latestTurn.lastHeartbeatAt).getTime();
					if (age < FRESH_HEARTBEAT_MS) {
						continue;
					}
				}

				await systemComment({
					experimentId: exp.id,
					nextAction: "action",
					content: "Agent run was interrupted (server restart). Please try again.",
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
		// Skip turns whose heartbeat is still fresh — the subprocess is
		// almost certainly still alive (tsx-watch dev restart case).
		const staleBefore = new Date(Date.now() - FRESH_HEARTBEAT_MS);
		const candidates = await db
			.select()
			.from(agentTurns)
			.where(and(eq(agentTurns.status, "running"), isNull(agentTurns.endedAt)));
		const toMark = candidates.filter(
			(t) => new Date(t.lastHeartbeatAt).getTime() < staleBefore.getTime(),
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
		}
		if (toMark.length > 0) {
			console.log(`[startup] Reconciled ${toMark.length} orphan agent_turns row(s)`);
		}
		const kept = candidates.length - toMark.length;
		if (kept > 0) {
			console.log(`[startup] Kept ${kept} running turn(s) with fresh heartbeat`);
		}
	} catch (err) {
		console.error("[startup] Failed to reconcile orphan agent_turns:", err);
	}
}
