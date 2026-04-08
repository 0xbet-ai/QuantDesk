import { db } from "@quantdesk/db";
import { agentTurns, comments, experiments } from "@quantdesk/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { systemComment } from "./comments.js";

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
		const updated = await db
			.update(agentTurns)
			.set({
				status: "failed",
				endedAt: new Date(),
				failureReason: "server_restart",
			})
			.where(and(eq(agentTurns.status, "running"), isNull(agentTurns.endedAt)))
			.returning({ id: agentTurns.id });
		if (updated.length > 0) {
			console.log(`[startup] Reconciled ${updated.length} orphan agent_turns row(s)`);
		}
	} catch (err) {
		console.error("[startup] Failed to reconcile orphan agent_turns:", err);
	}
}
