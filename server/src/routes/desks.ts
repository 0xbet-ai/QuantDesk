import { Router } from "express";
import { HttpError } from "../middleware/error.js";
import { listActivity } from "../services/activity.js";
import { triggerAgent } from "../services/agent-trigger.js";
import { archiveDesk, createDesk, getDesk, listDesks, updateDesk } from "../services/desks.js";
import { createExperiment, listExperiments } from "../services/experiments.js";

const router = Router();

router.post("/", async (req, res, next) => {
	try {
		const result = await createDesk(req.body);
		res.status(201).json(result);

		// Trigger agent for baseline experiment (async, don't block response)
		triggerAgent(result.experiment.id).catch((err) => {
			console.error("Agent trigger on desk creation failed:", err);
		});
	} catch (err) {
		next(err);
	}
});

router.get("/", async (_req, res, next) => {
	try {
		const result = await listDesks();
		res.json(result);
	} catch (err) {
		next(err);
	}
});

router.get("/:id", async (req, res, next) => {
	try {
		const desk = await getDesk(req.params.id);
		if (!desk) throw new HttpError(404, "Desk not found");
		res.json(desk);
	} catch (err) {
		next(err);
	}
});

router.patch("/:id", async (req, res, next) => {
	try {
		const desk = await updateDesk(req.params.id, req.body);
		if (!desk) throw new HttpError(404, "Desk not found");
		res.json(desk);
	} catch (err) {
		next(err);
	}
});

router.get("/:id/experiments", async (req, res, next) => {
	try {
		const result = await listExperiments(req.params.id);
		res.json(result);
	} catch (err) {
		next(err);
	}
});

router.post("/:id/experiments", async (req, res, next) => {
	try {
		const result = await createExperiment({ deskId: req.params.id, ...req.body });
		res.status(201).json(result);
	} catch (err) {
		next(err);
	}
});

router.post("/:id/archive", async (req, res, next) => {
	try {
		const desk = await archiveDesk(req.params.id);
		if (!desk) throw new HttpError(404, "Desk not found");
		res.json(desk);
	} catch (err) {
		next(err);
	}
});

router.get("/:id/activity", async (req, res, next) => {
	try {
		const result = await listActivity(req.params.id);
		res.json(result);
	} catch (err) {
		next(err);
	}
});

export default router;
