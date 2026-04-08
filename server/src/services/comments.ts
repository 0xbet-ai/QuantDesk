import { db } from "@quantdesk/db";
import { comments } from "@quantdesk/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentTurnId } from "./turn-context.js";

interface CreateCommentInput {
	experimentId: string;
	author: string;
	content: string;
	runId?: string;
	metadata?: Record<string, unknown>;
}

export async function createComment(input: CreateCommentInput) {
	const [comment] = await db
		.insert(comments)
		.values({
			experimentId: input.experimentId,
			author: input.author,
			content: input.content,
			runId: input.runId ?? null,
			turnId: getCurrentTurnId() ?? null,
			metadata: input.metadata ?? null,
		})
		.returning();

	return comment!;
}

export async function listComments(experimentId: string) {
	return db
		.select()
		.from(comments)
		.where(eq(comments.experimentId, experimentId))
		.orderBy(comments.createdAt);
}

/**
 * CLAUDE.md rule #12 — every lifecycle branch must surface a clear next action
 * to the user. Silent pauses are spec violations. `systemComment` is the only
 * sanctioned way to insert a system-authored comment, and it forces the
 * caller to declare why the invariant holds:
 *
 * - `action`    : the comment itself names the next move. `content` must be a
 *                 literal string containing one of `ACTION_PHRASE_PATTERNS`.
 *                 Verified by `server/src/__tests__/no-dead-end-lint.test.ts`.
 * - `retrigger` : the caller promises to call `triggerAgent` after this
 *                 comment, so the next action is the agent's, not the user's.
 * - `progress`  : mid-function status note; not a turn boundary. Unconstrained.
 *
 * Direct `createComment({ author: "system", ... })` outside this file is a
 * lint error (same test).
 */
export type SystemCommentNextAction = "action" | "retrigger" | "progress";

interface SystemCommentInput {
	experimentId: string;
	content: string;
	nextAction: SystemCommentNextAction;
	runId?: string;
	metadata?: Record<string, unknown>;
}

export async function systemComment(input: SystemCommentInput) {
	return createComment({
		experimentId: input.experimentId,
		author: "system",
		content: input.content,
		runId: input.runId,
		metadata: input.metadata,
	});
}

/**
 * Action phrases that satisfy rule #12 for `nextAction: "action"`. Kept
 * deliberately small. Add one only when a new branch needs it and cannot
 * reuse an existing phrase.
 */
export const ACTION_PHRASE_PATTERNS: readonly RegExp[] = [
	/reply with/i,
	/please try again/i,
	/you may now/i,
	/proceed to/i,
	/propose (?:a |the |an )/i,
	/\[(?:RUN|PROPOSE)_[A-Z_]+\]/, // instructs the agent to emit a marker
	/start your response with/i,
	/click approve/i,
	/click retry/i,
	/approve to/i,
];

export function contentHasActionPhrase(content: string): boolean {
	return ACTION_PHRASE_PATTERNS.some((re) => re.test(content));
}
