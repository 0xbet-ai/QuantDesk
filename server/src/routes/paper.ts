import { Router } from "express";
import { db } from "@quantdesk/db";
import { desks } from "@quantdesk/db/schema";
import { getAdapter as getEngineAdapter } from "@quantdesk/engines";
import { eq } from "drizzle-orm";
import { publishExperimentEvent } from "../realtime/live-events.js";
import {
	failSession,
	getActiveSession,
	getLatestSession,
	markSessionRunning,
	startPaperSession,
	stopSession,
} from "../services/paper-sessions.js";

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
		const [desk] = await db
			.select()
			.from(desks)
			.where(eq(desks.id, req.params.deskId));
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
	} catch (err) {
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
		if (!desk) { res.json([]); return; }
		const adapter = getEngineAdapter(desk.engine);
		if (typeof adapter.getPaperTrades !== "function") { res.json([]); return; }
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
		if (!desk) { res.json([]); return; }
		const adapter = getEngineAdapter(desk.engine);
		if (typeof adapter.getPaperCandles !== "function") { res.json([]); return; }
		const pair = (req.query.pair as string) || "BTC/USDT";
		const timeframe = (req.query.timeframe as string) || "5m";
		const candles = await adapter.getPaperCandles(
			{ containerName: session.containerName, runId: session.runId, meta: (session.meta as Record<string, unknown>) ?? {} },
			pair, timeframe,
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
		const { runId, experimentId } = req.body as {
			runId: string;
			experimentId: string;
		};
		if (!runId || !experimentId) {
			res.status(400).json({ error: "runId and experimentId are required" });
			return;
		}

		const session = await startPaperSession({
			runId,
			deskId: req.params.deskId,
			experimentId,
		});

		// Spawn container.
		const [desk] = await db
			.select()
			.from(desks)
			.where(eq(desks.id, req.params.deskId));
		if (!desk || !desk.workspacePath) {
			await failSession(session.id, "desk not found or no workspace");
			res.status(500).json({ error: "desk not found or no workspace" });
			return;
		}

		const engineAdapter = getEngineAdapter(desk.engine);
		const venue = (desk.venues as string[])[0] ?? "binance";

		const handle = await engineAdapter.startPaper({
			strategyPath: "strategy.py",
			runId,
			workspacePath: desk.workspacePath,
			exchange: venue,
			pairs: ["BTC/USDT"],
			timeframe: "5m",
			wallet: Number(desk.budget) || 10000,
			extraVolumes: (desk.externalMounts ?? []).map(
				(m) => `${m.hostPath}:/workspace/data/external/${m.label}:ro`,
			),
		});

		await markSessionRunning(session.id, {
			containerName: handle.containerName,
			apiPort: handle.meta?.apiPort as number | undefined,
			meta: handle.meta ?? undefined,
		});

		publishExperimentEvent({
			experimentId,
			type: "paper.status",
			payload: { sessionId: session.id, status: "running" },
		});

		res.json({ sessionId: session.id, status: "running" });
	} catch (err) {
		const msg = (err as Error).message;
		const status = msg.includes("not been validated") || msg.includes("already has") ? 409 : 500;
		res.status(status).json({ error: msg });
	}
});

/** POST /api/desks/:deskId/paper/stop — stop the active paper session. */
router.post("/desks/:deskId/paper/stop", async (req, res) => {
	try {
		const session = await getActiveSession(req.params.deskId);
		if (!session) {
			res.status(404).json({ error: "no active paper session" });
			return;
		}

		const [desk] = await db
			.select()
			.from(desks)
			.where(eq(desks.id, req.params.deskId));
		if (desk) {
			const engineAdapter = getEngineAdapter(desk.engine);
			try {
				await engineAdapter.stopPaper({
					containerName: session.containerName ?? "",
					runId: session.runId,
					meta: (session.meta as Record<string, unknown>) ?? {},
				});
			} catch {
				// Container may already be gone.
			}
		}

		await stopSession(session.id);

		publishExperimentEvent({
			experimentId: session.experimentId,
			type: "paper.status",
			payload: { sessionId: session.id, status: "stopped" },
		});

		res.json({ stopped: true, sessionId: session.id });
	} catch (err) {
		res.status(500).json({ error: (err as Error).message });
	}
});

export default router;
