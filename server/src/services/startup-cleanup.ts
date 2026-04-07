import { db } from "@quantdesk/db";
import { comments, experiments } from "@quantdesk/db/schema";
import { eq } from "drizzle-orm";
import { createComment } from "./comments.js";

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

				await createComment({
					experimentId: exp.id,
					author: "system",
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
