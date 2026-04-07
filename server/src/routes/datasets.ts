import { Router } from "express";
import { HttpError } from "../middleware/error.js";
import { deleteDataset, listAllDatasets, previewDataset } from "../services/datasets.js";

const router = Router();

/** Global dataset catalog — one entry per (exchange, pairs, timeframe, date range). */
router.get("/", async (_req, res, next) => {
	try {
		const result = await listAllDatasets();
		res.json(result);
	} catch (err) {
		next(err);
	}
});

router.get("/:id/preview", async (req, res, next) => {
	try {
		const limit = Number.parseInt((req.query.limit as string) ?? "50", 10);
		const preview = await previewDataset(req.params.id, limit);
		if (!preview) throw new HttpError(404, "Dataset file not found");
		res.json(preview);
	} catch (err) {
		next(err);
	}
});

router.delete("/:id", async (req, res, next) => {
	try {
		const deleted = await deleteDataset(req.params.id);
		if (!deleted) throw new HttpError(404, "Dataset not found");
		res.json(deleted);
	} catch (err) {
		next(err);
	}
});

export default router;
