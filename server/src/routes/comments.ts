/**
 * Generic approval router for comments carrying a `pendingProposal`.
 *
 * Spec: `doc/agent/MARKERS.md` Proposal markers section + CLAUDE.md rule #15.
 *
 * The UI does not need to know which proposal type lives on a comment — it
 * just POSTs to `/api/comments/:commentId/approve` (or `/reject`) and the
 * server dispatches to the registered handler keyed by
 * `comment.metadata.pendingProposal.type`.
 *
 * Registration happens once at server boot via `registerAllProposalHandlers`
 * in `server/src/services/proposal-handlers/index.ts`.
 */

import { Router } from "express";
import { HttpError } from "../middleware/error.js";
import { publishExperimentEvent } from "../realtime/live-events.js";
import {
	extractPendingProposal,
	getProposalHandler,
	loadComment,
	resolvePendingProposal,
} from "../services/proposal-handlers/registry.js";

const router = Router();

router.post("/:commentId/approve", async (req, res, next) => {
	try {
		const comment = await loadComment(req.params.commentId);
		if (!comment) throw new HttpError(404, "comment not found");
		const proposal = extractPendingProposal(comment.metadata);
		if (!proposal) {
			throw new HttpError(400, "comment has no pendingProposal to approve");
		}
		const handler = getProposalHandler(proposal.type);
		if (!handler) {
			throw new HttpError(
				400,
				`no approve handler registered for proposal type "${proposal.type}"`,
			);
		}

		// Mark resolved before dispatching so a crash cannot leave a
		// re-clickable button behind.
		await resolvePendingProposal(comment.id, "approved");

		res.status(202).json({ ok: true });

		handler
			.onApprove({ comment, proposal })
			.then(() => {
				publishExperimentEvent({
					experimentId: comment.experimentId,
					type: "comment.new",
					payload: {},
				});
			})
			.catch((err) => {
				console.error(`Proposal approve handler (${proposal.type}) failed:`, err);
			});
	} catch (err) {
		next(err);
	}
});

router.post("/:commentId/reject", async (req, res, next) => {
	try {
		const comment = await loadComment(req.params.commentId);
		if (!comment) throw new HttpError(404, "comment not found");
		const proposal = extractPendingProposal(comment.metadata);
		if (!proposal) {
			throw new HttpError(400, "comment has no pendingProposal to reject");
		}
		const handler = getProposalHandler(proposal.type);
		if (!handler) {
			throw new HttpError(400, `no reject handler registered for proposal type "${proposal.type}"`);
		}

		await resolvePendingProposal(comment.id, "rejected");

		res.status(202).json({ ok: true });

		handler
			.onReject({ comment, proposal })
			.then(() => {
				publishExperimentEvent({
					experimentId: comment.experimentId,
					type: "comment.new",
					payload: {},
				});
			})
			.catch((err) => {
				console.error(`Proposal reject handler (${proposal.type}) failed:`, err);
			});
	} catch (err) {
		next(err);
	}
});

export default router;
