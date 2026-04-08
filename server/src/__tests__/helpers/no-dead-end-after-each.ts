/**
 * Phase 02 — opt-in afterEach hook for integration tests.
 *
 * Usage from any integration test that already drives a real desk through
 * `triggerAgent` and the proposal router:
 *
 *   import { afterEach } from "vitest";
 *   import { assertNoDeadEnd } from "../helpers/no-dead-end-after-each.js";
 *
 *   describe("my flow", () => {
 *     let deskId: string;
 *     // ...setup...
 *     afterEach(async () => assertNoDeadEnd(deskId));
 *   });
 *
 * Implementation gathers a `DeskInvariantSnapshot` from the DB and forwards
 * it to the pure `hasNextAction` checker. The retrigger queue check is a
 * placeholder (`retriggerPending: false`) until phase 14 introduces an
 * observable queue — until then, integration tests that legitimately rely
 * on a pending retrigger should set `expectRetrigger: true` to bypass.
 *
 * No real integration tests exist yet; this helper is shipped so phases
 * that add them can adopt it on day one.
 */

import { db } from "@quantdesk/db";
import { comments, experiments } from "@quantdesk/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { type DeskInvariantSnapshot, hasNextAction } from "../../services/has-next-action.js";

interface AssertOptions {
	expectRetrigger?: boolean;
}

export async function assertNoDeadEnd(deskId: string, opts: AssertOptions = {}): Promise<void> {
	const snapshot = await collectSnapshot(deskId, opts);
	const result = hasNextAction(snapshot);
	if (!result.ok) {
		throw new Error(
			`rule #12 violation on desk ${deskId}: ${result.reason}\n` +
				`snapshot=${JSON.stringify(snapshot, null, 2)}`,
		);
	}
}

async function collectSnapshot(
	deskId: string,
	opts: AssertOptions,
): Promise<DeskInvariantSnapshot> {
	const deskExperiments = await db
		.select({ id: experiments.id })
		.from(experiments)
		.where(eq(experiments.deskId, deskId));
	const experimentIds = deskExperiments.map((e) => e.id);

	if (experimentIds.length === 0) {
		return {
			pendingProposalCount: 0,
			latestSystemCommentContent: null,
			retriggerPending: opts.expectRetrigger ?? false,
		};
	}

	// Count comments whose metadata still has a `pendingProposal` key.
	// Drizzle/jsonb path query is verbose; do it client-side over the small
	// per-desk slice.
	const allComments = await db
		.select()
		.from(comments)
		.where(and(eq(comments.author, "system")))
		.orderBy(desc(comments.createdAt));

	let pendingProposalCount = 0;
	let latestSystemCommentContent: string | null = null;
	for (const c of allComments) {
		if (!experimentIds.includes(c.experimentId)) continue;
		if (latestSystemCommentContent === null) {
			latestSystemCommentContent = c.content;
		}
		if (c.metadata && (c.metadata as Record<string, unknown>).pendingProposal) {
			pendingProposalCount++;
		}
	}

	return {
		pendingProposalCount,
		latestSystemCommentContent,
		retriggerPending: opts.expectRetrigger ?? false,
	};
}
