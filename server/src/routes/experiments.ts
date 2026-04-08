import { Router } from "express";
import { HttpError } from "../middleware/error.js";
import { publishExperimentEvent } from "../realtime/live-events.js";
import { readAgentLog } from "../services/agent-log.js";
import { stopAgent, triggerAgent } from "../services/agent-trigger.js";
import { createComment, listComments, systemComment } from "../services/comments.js";
import { executeDataFetch } from "../services/data-fetch.js";
import { completeAndCreateNewExperiment, getExperiment } from "../services/experiments.js";
import { listRuns } from "../services/runs.js";
import type { DataFetchProposal } from "../services/triggers.js";

const router = Router();

router.get("/:id", async (req, res, next) => {
	try {
		const experiment = await getExperiment(req.params.id);
		if (!experiment) throw new HttpError(404, "Experiment not found");
		res.json(experiment);
	} catch (err) {
		next(err);
	}
});

router.get("/:id/runs", async (req, res, next) => {
	try {
		const result = await listRuns(req.params.id);
		res.json(result);
	} catch (err) {
		next(err);
	}
});

router.post("/:id/comments", async (req, res, next) => {
	try {
		const comment = await createComment({
			experimentId: req.params.id,
			...req.body,
		});

		// Broadcast to WebSocket clients
		publishExperimentEvent({
			experimentId: req.params.id,
			type: "comment.new",
			payload: comment as unknown as Record<string, unknown>,
		});

		res.status(201).json(comment);

		// Trigger agent asynchronously (don't block HTTP response)
		if (comment.author === "user" || comment.author === "system") {
			triggerAgent(req.params.id).catch((err) => {
				console.error("Agent trigger failed:", err);
			});
		}
	} catch (err) {
		next(err);
	}
});

router.get("/:id/comments", async (req, res, next) => {
	try {
		const result = await listComments(req.params.id);
		res.json(result);
	} catch (err) {
		next(err);
	}
});

router.get("/:id/agent/logs", async (req, res, next) => {
	try {
		const entries = readAgentLog(req.params.id);
		res.json(entries);
	} catch (err) {
		next(err);
	}
});

router.post("/:id/complete-and-new", async (req, res, next) => {
	try {
		const { title, description } = req.body as { title?: string; description?: string };
		if (!title || typeof title !== "string" || !title.trim()) {
			throw new HttpError(400, "title is required");
		}
		const newExperiment = await completeAndCreateNewExperiment({
			currentExperimentId: req.params.id,
			newTitle: title.trim(),
			newDescription: description,
		});

		// Insert a kickoff system comment and trigger agent to propose next direction
		const kickoff = await systemComment({
			experimentId: newExperiment.id,
			nextAction: "action",
			content:
				"Based on the previous experiment's findings, propose the next experiment direction. Start your response with a line in the format: [EXPERIMENT_TITLE] <short title for this new experiment>",
		});

		publishExperimentEvent({
			experimentId: newExperiment.id,
			type: "comment.new",
			payload: kickoff as unknown as Record<string, unknown>,
		});

		res.status(201).json(newExperiment);

		// Trigger agent asynchronously
		triggerAgent(newExperiment.id).catch((err) => {
			console.error("Agent trigger failed on new experiment:", err);
		});
	} catch (err) {
		next(err);
	}
});

/**
 * Approve (and execute) or reject an agent-emitted data-fetch proposal.
 * Body: { action: "approve" | "reject", proposal: DataFetchProposal }
 */
router.post("/:id/data-fetch", async (req, res, next) => {
	try {
		const { action, proposal } = req.body as {
			action?: "approve" | "reject";
			proposal?: DataFetchProposal;
		};
		if (action !== "approve" && action !== "reject") {
			throw new HttpError(400, "action must be 'approve' or 'reject'");
		}
		if (!proposal) throw new HttpError(400, "proposal is required");

		res.status(202).json({ ok: true });

		if (action === "reject") {
			await createComment({
				experimentId: req.params.id,
				author: "user",
				content:
					`Data-fetch proposal rejected: ${proposal.pairs.join(", ")} ${proposal.timeframe} ` +
					`${proposal.days}d on ${proposal.exchange}. Propose a different dataset.`,
			});
			publishExperimentEvent({
				experimentId: req.params.id,
				type: "comment.new",
				payload: {},
			});
			triggerAgent(req.params.id).catch((err) => {
				console.error("Agent trigger after reject failed:", err);
			});
			return;
		}

		// Approve: run the fetcher in the background, then re-trigger the agent.
		executeDataFetch({ experimentId: req.params.id, proposal })
			.then(() => {
				publishExperimentEvent({
					experimentId: req.params.id,
					type: "comment.new",
					payload: {},
				});
				return triggerAgent(req.params.id);
			})
			.catch((err) => {
				console.error("executeDataFetch failed:", err);
			});
	} catch (err) {
		next(err);
	}
});

router.post("/:id/agent/stop", async (req, res, next) => {
	try {
		const stopped = stopAgent(req.params.id);
		res.json({ stopped });
	} catch (err) {
		next(err);
	}
});

export default router;
