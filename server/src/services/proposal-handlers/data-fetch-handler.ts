/**
 * Approve/reject handler for `PROPOSE_DATA_FETCH` (marker P1 in
 * `doc/agent/MARKERS.md`). Ported out of `routes/experiments.ts` where it
 * used to live behind a hard-coded `/experiments/:id/data-fetch` route.
 *
 * On approve: runs `executeDataFetch` (cache hit or download container),
 * then retriggers the agent. On reject: posts a user comment naming the
 * rejection and retriggers so the agent can propose a revised fetch.
 *
 * Rule #15 is satisfied by the retrigger in both branches.
 */

import { triggerAgent } from "../agent-trigger.js";
import { createComment } from "../comments.js";
import { executeDataFetch } from "../data-fetch.js";
import type { DataFetchProposal } from "../triggers.js";
import { registerProposalHandler } from "./registry.js";

function isDataFetchProposal(value: unknown): value is DataFetchProposal {
	if (!value || typeof value !== "object") return false;
	const obj = value as Partial<DataFetchProposal>;
	return (
		typeof obj.exchange === "string" &&
		Array.isArray(obj.pairs) &&
		typeof obj.timeframe === "string" &&
		typeof obj.days === "number"
	);
}

export function registerDataFetchHandler(): void {
	registerProposalHandler({
		type: "data_fetch",
		async onApprove({ comment, proposal }) {
			if (!isDataFetchProposal(proposal.data)) {
				throw new Error("data_fetch proposal payload is malformed");
			}
			await executeDataFetch({
				experimentId: comment.experimentId,
				proposal: proposal.data,
				parentCommentId: comment.id,
			});
			await triggerAgent(comment.experimentId);
		},
		async onReject({ comment, proposal }) {
			const data = isDataFetchProposal(proposal.data) ? proposal.data : null;
			const summary = data
				? `${data.pairs.join(", ")} ${data.timeframe} ${data.days}d on ${data.exchange}`
				: "the proposed dataset";
			await createComment({
				experimentId: comment.experimentId,
				author: "user",
				content: `Data-fetch proposal rejected: ${summary}. Propose a different dataset.`,
			});
			await triggerAgent(comment.experimentId);
		},
	});
}
