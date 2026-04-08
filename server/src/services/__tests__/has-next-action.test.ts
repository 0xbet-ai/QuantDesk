/**
 * Phase 02 — unit tests for the `hasNextAction` invariant. The function is
 * pure; the DB-touching `assertNoDeadEnd(deskId)` afterEach helper that wraps
 * it lives in `server/src/__tests__/helpers/no-dead-end-after-each.ts` and is
 * exercised by integration tests when those land.
 */

import { describe, expect, it } from "vitest";
import { hasNextAction } from "../has-next-action.js";

describe("hasNextAction (rule #15 invariant)", () => {
	it("passes when the agent is still in the retrigger queue", () => {
		const result = hasNextAction({
			pendingProposalCount: 0,
			latestSystemCommentContent: null,
			retriggerPending: true,
		});
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.reason).toBe("retrigger");
	});

	it("passes when there is at least one unresolved pendingProposal", () => {
		const result = hasNextAction({
			pendingProposalCount: 1,
			latestSystemCommentContent: null,
			retriggerPending: false,
		});
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.reason).toBe("pendingProposal");
	});

	it("passes when the latest system comment contains an action phrase", () => {
		const result = hasNextAction({
			pendingProposalCount: 0,
			latestSystemCommentContent: "Cannot run backtest: you must emit [PROPOSE_DATA_FETCH] first.",
			retriggerPending: false,
		});
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.reason).toBe("actionPhrase");
	});

	it("fails when none of the three conditions hold", () => {
		const result = hasNextAction({
			pendingProposalCount: 0,
			latestSystemCommentContent: "Backtest complete.",
			retriggerPending: false,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toMatch(/no pendingProposal, no action phrase, no retrigger/);
		}
	});

	it("fails when there is no system comment at all and nothing else holds", () => {
		const result = hasNextAction({
			pendingProposalCount: 0,
			latestSystemCommentContent: null,
			retriggerPending: false,
		});
		expect(result.ok).toBe(false);
	});

	it("retrigger short-circuits even if other conditions also hold", () => {
		const result = hasNextAction({
			pendingProposalCount: 5,
			latestSystemCommentContent: "Reply with anything.",
			retriggerPending: true,
		});
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.reason).toBe("retrigger");
	});

	it("a system comment of 'Backtest failed.' alone is a dead end", () => {
		const result = hasNextAction({
			pendingProposalCount: 0,
			latestSystemCommentContent: "Backtest failed.",
			retriggerPending: false,
		});
		expect(result.ok).toBe(false);
	});

	it("the same comment with 'Reply with guidance to retry.' tail passes", () => {
		const result = hasNextAction({
			pendingProposalCount: 0,
			latestSystemCommentContent: "Backtest failed. Reply with guidance to retry.",
			retriggerPending: false,
		});
		expect(result.ok).toBe(true);
	});
});
