import { db } from "@quantdesk/db";
import { agentTurns, comments, runs } from "@quantdesk/db/schema";
import { asc, eq } from "drizzle-orm";

/**
 * Phase 27 — Turn-scoped read API. `GET /api/turns/:id` returns the turn row
 * plus every child the UI's `TurnCard` needs to render without additional
 * round-trips: the linked run (if any) and the agent/system comments emitted
 * inside that turn in chronological order.
 */
export async function getTurn(turnId: string) {
	const [turn] = await db.select().from(agentTurns).where(eq(agentTurns.id, turnId));
	if (!turn) return null;

	const turnComments = await db
		.select()
		.from(comments)
		.where(eq(comments.turnId, turnId))
		.orderBy(asc(comments.createdAt));

	const turnRuns = await db.select().from(runs).where(eq(runs.turnId, turnId));

	return {
		turn,
		comments: turnComments,
		runs: turnRuns,
	};
}

/**
 * List every turn for an experiment in chronological order. Used by
 * `CommentThread` to render one `TurnCard` per turn row instead of the
 * current ephemeral streaming-only widget.
 */
export async function listTurnsForExperiment(experimentId: string) {
	return db
		.select()
		.from(agentTurns)
		.where(eq(agentTurns.experimentId, experimentId))
		.orderBy(asc(agentTurns.startedAt));
}
