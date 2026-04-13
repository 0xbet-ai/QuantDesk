import { db } from "@quantdesk/db";
import { desks } from "@quantdesk/db/schema";
import { getAdapter as getEngineAdapter } from "@quantdesk/engines";
import { eq } from "drizzle-orm";
import { Router } from "express";
import { getActiveSession, getLatestSession, stopPaper } from "../services/paper-sessions.js";
import { goPaper } from "../services/runs.js";

const router = Router();

/** GET /api/desks/:deskId/paper — get the latest paper session (any status). */
router.get("/desks/:deskId/paper", async (req, res) => {
	try {
		const session = await getLatestSession(req.params.deskId);
		res.json(session ?? null);
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
	}
});

/** GET /api/desks/:deskId/paper/status — live PnL/position status from the engine container. */
router.get("/desks/:deskId/paper/status", async (req, res) => {
	try {
		const session = await getActiveSession(req.params.deskId);
		if (!session || session.status !== "running" || !session.containerName) {
			res.json(null);
			return;
		}
		const [desk] = await db.select().from(desks).where(eq(desks.id, req.params.deskId));
		if (!desk) {
			res.json(null);
			return;
		}
		const engineAdapter = getEngineAdapter(desk.engine);
		const status = await engineAdapter.getPaperStatus({
			containerName: session.containerName,
			runId: session.runId,
			meta: (session.meta as Record<string, unknown>) ?? {},
		});
		res.json(status);
	} catch (_err) {
		// Container might be temporarily unreachable — return null
		// rather than 500 so the UI degrades gracefully.
		res.json(null);
	}
});

/** GET /api/desks/:deskId/paper/trades — trade history from the running paper session. */
router.get("/desks/:deskId/paper/trades", async (req, res) => {
	try {
		const session = await getActiveSession(req.params.deskId);
		if (!session || session.status !== "running" || !session.containerName) {
			res.json([]);
			return;
		}
		const [desk] = await db.select().from(desks).where(eq(desks.id, req.params.deskId));
		if (!desk) {
			res.json([]);
			return;
		}
		const adapter = getEngineAdapter(desk.engine);
		if (typeof adapter.getPaperTrades !== "function") {
			res.json([]);
			return;
		}
		const trades = await adapter.getPaperTrades({
			containerName: session.containerName,
			runId: session.runId,
			meta: (session.meta as Record<string, unknown>) ?? {},
		});
		res.json(trades);
	} catch {
		res.json([]);
	}
});

/** GET /api/desks/:deskId/paper/candles?pair=X&timeframe=Y — candle data from the running paper session. */
router.get("/desks/:deskId/paper/candles", async (req, res) => {
	try {
		const session = await getActiveSession(req.params.deskId);
		if (!session || session.status !== "running" || !session.containerName) {
			res.json([]);
			return;
		}
		const [desk] = await db.select().from(desks).where(eq(desks.id, req.params.deskId));
		if (!desk) {
			res.json([]);
			return;
		}
		const adapter = getEngineAdapter(desk.engine);
		if (typeof adapter.getPaperCandles !== "function") {
			res.json([]);
			return;
		}
		const pair = (req.query.pair as string) || "BTC/USDT";
		const timeframe = (req.query.timeframe as string) || "5m";
		const candles = await adapter.getPaperCandles(
			{
				containerName: session.containerName,
				runId: session.runId,
				meta: (session.meta as Record<string, unknown>) ?? {},
			},
			pair,
			timeframe,
		);
		res.json(candles);
	} catch {
		res.json([]);
	}
});

/** GET /api/desks/:deskId/paper/active — get the active (running/pending) session, or null. */
router.get("/desks/:deskId/paper/active", async (req, res) => {
	try {
		const session = await getActiveSession(req.params.deskId);
		res.json(session ?? null);
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
	}
});

/** POST /api/desks/:deskId/paper/start — promote a validated run to paper trading. */
router.post("/desks/:deskId/paper/start", async (req, res) => {
	try {
		const { runId } = req.body as { runId: string };
		if (!runId) {
			res.status(400).json({ error: "runId is required" });
			return;
		}
		const paperRun = await goPaper(runId);
		res.json({ runId: paperRun.id, status: "running" });
	} catch (err) {
		const msg = (err as Error).message;
		const status = msg.includes("not been validated") || msg.includes("already has") ? 409 : 500;
		res.status(status).json({ error: msg });
	}
});

/** POST /api/desks/:deskId/paper/stop — stop the active paper session. */
router.post("/desks/:deskId/paper/stop", async (req, res) => {
	try {
		const result = await stopPaper(req.params.deskId);
		res.json({ stopped: true, sessionId: result.sessionId });
	} catch (err) {
		const msg = (err as Error).message;
		const status = msg.includes("No active") ? 404 : 500;
		res.status(status).json({ error: msg });
	}
});

export default router;
