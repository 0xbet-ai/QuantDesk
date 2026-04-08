/**
 * CLAUDE.md rule #15 — `hasNextAction` is the invariant every dispatch must
 * satisfy on completion. Phase 02 ships it as a **pure function** so any
 * future integration test (or runtime guard) can call it without spinning up
 * a DB harness.
 *
 * The invariant holds when at least one of:
 *   (a) the desk has an unresolved `pendingProposal` on some comment, so
 *       the user has Approve/Reject buttons,
 *   (b) the latest system-authored comment contains an action phrase from
 *       `ACTION_PHRASE_PATTERNS`, naming the user's next move, or
 *   (c) the agent is still in the retrigger queue, so the next move is the
 *       agent's, not the user's.
 *
 * `hasNextAction` itself takes a normalized snapshot — gathering the snapshot
 * from a real desk is the responsibility of the test/runtime caller. This
 * keeps the function unit-testable without DB access.
 */

import { contentHasActionPhrase } from "./comments.js";

export interface DeskInvariantSnapshot {
	/** Number of comments in the desk that still carry an unresolved `pendingProposal`. */
	pendingProposalCount: number;
	/**
	 * Content of the latest system-authored comment in the desk, or `null`
	 * if there is no system comment yet.
	 */
	latestSystemCommentContent: string | null;
	/**
	 * Whether the agent retrigger queue has a pending entry for this desk.
	 * `true` means the next agent turn is already scheduled, so the user
	 * does not need to act.
	 */
	retriggerPending: boolean;
}

/** Reasons a snapshot fails / passes the invariant — useful in test failure messages. */
export type InvariantOutcome =
	| { ok: true; reason: "pendingProposal" | "actionPhrase" | "retrigger" }
	| { ok: false; reason: "no pendingProposal, no action phrase, no retrigger" };

export function hasNextAction(snapshot: DeskInvariantSnapshot): InvariantOutcome {
	if (snapshot.retriggerPending) {
		return { ok: true, reason: "retrigger" };
	}
	if (snapshot.pendingProposalCount > 0) {
		return { ok: true, reason: "pendingProposal" };
	}
	if (
		snapshot.latestSystemCommentContent !== null &&
		contentHasActionPhrase(snapshot.latestSystemCommentContent)
	) {
		return { ok: true, reason: "actionPhrase" };
	}
	return { ok: false, reason: "no pendingProposal, no action phrase, no retrigger" };
}
