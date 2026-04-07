import { Router } from "express";
import { HttpError } from "../middleware/error.js";
import { publishExperimentEvent } from "../realtime/live-events.js";
import { readAgentLog } from "../services/agent-log.js";
import { stopAgent, triggerAgent } from "../services/agent-trigger.js";
import { createComment, listComments } from "../services/comments.js";
import { completeAndCreateNewExperiment, getExperiment } from "../services/experiments.js";
import { listRuns } from "../services/runs.js";

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
		res.status(201).json(newExperiment);
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
