import { Router } from "express";
import { HttpError } from "../middleware/error.js";
import { getRunStatus, goPaper, stopRun } from "../services/runs.js";

const router = Router();

router.post("/:id/go-paper", async (req, res, next) => {
	try {
		const result = await goPaper(req.params.id);
		res.status(201).json(result);
	} catch (err) {
		if (err instanceof Error && err.message.includes("Can only")) {
			next(new HttpError(400, err.message));
		} else {
			next(err);
		}
	}
});

router.post("/:id/stop", async (req, res, next) => {
	try {
		const result = await stopRun(req.params.id);
		res.json(result);
	} catch (err) {
		if (err instanceof Error && err.message.includes("Can only")) {
			next(new HttpError(400, err.message));
		} else {
			next(err);
		}
	}
});

router.get("/:id/status", async (req, res, next) => {
	try {
		const result = await getRunStatus(req.params.id);
		res.json(result);
	} catch (err) {
		next(err);
	}
});

export default router;
