import { db } from "@quantdesk/db";
import { comments } from "@quantdesk/db/schema";
import { Router } from "express";
import { eq } from "drizzle-orm";
import { HttpError } from "../middleware/error.js";
import { publishExperimentEvent } from "../realtime/live-events.js";
import { readAgentLog } from "../services/agent-log.js";
import { stopAgent, triggerAgent } from "../services/agent-trigger.js";
import { createComment, listComments, systemComment } from "../services/comments.js";
import {
	completeAndCreateNewExperiment,
	deleteExperiment,
	getExperiment,
} from "../services/experiments.js";
import {
	extractPendingProposal,
	resolvePendingProposal,
} from "../services/proposal-handlers/registry.js";
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

		// CLAUDE.md rule #15 — when a user replies while a pendingProposal is
		// still unresolved, auto-supersede the proposal so its Approve/Reject
		// buttons disappear. The agent's next turn will see the user reply and
		// either revise the proposal or address the question; leaving stale
		// buttons around invites accidental clicks on a proposal the user has
		// already moved past.
		if (comment.author === "user") {
			const stale = await db
				.select()
				.from(comments)
				.where(eq(comments.experimentId, req.params.id));
			for (const c of stale) {
				if (c.id === comment.id) continue;
				if (extractPendingProposal(c.metadata)) {
					await resolvePendingProposal(c.id, "rejected");
				}
			}
		}

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

router.delete("/:id", async (req, res, next) => {
	try {
		const existing = await getExperiment(req.params.id);
		if (!existing) throw new HttpError(404, "Experiment not found");
		try {
			await deleteExperiment(req.params.id);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes("last experiment")) {
				throw new HttpError(409, msg);
			}
			throw err;
		}
		res.status(204).end();
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
