import { Router } from "express";
import { listStrategies } from "../services/strategies.js";

const router = Router();

router.get("/", async (req, res, next) => {
	try {
		const engine = typeof req.query.engine === "string" ? req.query.engine : undefined;
		const result = await listStrategies(engine);
		res.json(result);
	} catch (err) {
		next(err);
	}
});

export default router;
