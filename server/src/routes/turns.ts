import { Router } from "express";
import { HttpError } from "../middleware/error.js";
import { getTurn } from "../services/turns.js";

const router = Router();

router.get("/:id", async (req, res, next) => {
	try {
		const result = await getTurn(req.params.id);
		if (!result) throw new HttpError(404, "Turn not found");
		res.json(result);
	} catch (err) {
		next(err);
	}
});

export default router;
