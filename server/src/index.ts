import { createServer } from "node:http";
import { initDb } from "@quantdesk/db";
import { setEngineRuntimeConfig } from "@quantdesk/engines";
import express from "express";
import { getConfig } from "./config-file.js";
import { handleMcpRequest } from "./mcp/http-route.js";
import { setTriggerAgent } from "./mcp/server.js";
import { actorMiddleware } from "./middleware/auth.js";
import { errorHandler } from "./middleware/error.js";
import { setupWebSocket } from "./realtime/websocket.js";
import commentsRouter from "./routes/comments.js";
import datasetsRouter from "./routes/datasets.js";
import desksRouter from "./routes/desks.js";
import experimentsRouter from "./routes/experiments.js";
import fsRouter from "./routes/fs.js";
import paperRouter from "./routes/paper.js";
import runsRouter from "./routes/runs.js";
import strategiesRouter from "./routes/strategies.js";
import turnsRouter from "./routes/turns.js";
import { triggerAgent } from "./services/agent-trigger.js";
import {
	cleanupStaleAgentRuns,
	reconcileOrphanAgentTurns,
	reconcileOrphanScriptContainers,
	reconcilePaperSessions,
} from "./services/startup-cleanup.js";
import { startTurnWatchdog } from "./services/turn-watchdog.js";

// Load global config once — defaults fall through when no file exists
// so a fresh install boots with zero configuration. See config-file.ts
// for the precedence rules (env > file > defaults).
const config = getConfig();
if (config.configPath) {
	console.log(`[config] Loaded from ${config.configPath}`);
}

// Bridge the engine-specific subset of the config into the @quantdesk/engines
// package so adapters (freqtrade, nautilus, generic) can pick up image
// overrides, resource limits, freqtrade startup knobs, and the paper stop
// grace period without importing from the server (circular dep).
setEngineRuntimeConfig({
	imageOverrides: config.engine.imageOverrides,
	backtest: config.engine.backtest,
	paper: config.engine.paper,
	generic: config.engine.generic,
	freqtrade: config.engine.freqtrade,
	paperStopGracefulSec: config.paper.containerStopGracefulTimeoutSec,
});

// Initialise database (starts embedded Postgres on first run if DATABASE_URL is unset)
await initDb();

const app = express();
const port = config.server.port;

app.use(express.json());

// ── Health endpoint (public, no auth) ───────────────────────────────
// Exposes deploymentMode so the UI can decide whether to show a login
// page. Called before the auth middleware is mounted so it's always
// reachable.
app.get("/api/health", (_req, res) => {
	res.json({
		status: "ok",
		deploymentMode: config.auth.deploymentMode,
	});
});

// ── Auth routes + middleware ─────────────────────────────────────────
// In authenticated mode, Better Auth handles /api/auth/* (sign-in,
// sign-up, sign-out, get-session). The actorMiddleware resolves
// session cookies for every subsequent request.
// In local_trusted mode, the middleware auto-assigns an admin actor
// and no auth routes are needed.
if (config.auth.deploymentMode === "authenticated") {
	// Lazy-import to avoid loading auth code in local mode.
	// Cookie parser needed for session token extraction.
	const cookieParser = (await import("cookie-parser")).default;
	app.use(cookieParser());
	const { createAuthRouter, resolveSession } = await import("./auth/better-auth.js");
	app.use("/api/auth", createAuthRouter({ disableSignUp: config.auth.disableSignUp }));
	app.use(actorMiddleware({
		deploymentMode: config.auth.deploymentMode,
		resolveSession: (req) => resolveSession(req),
	}));
} else {
	app.use(actorMiddleware({ deploymentMode: "local_trusted" }));
}

app.use("/api/desks", desksRouter);
app.use("/api/experiments", experimentsRouter);
app.use("/api/comments", commentsRouter);
app.use("/api/runs", runsRouter);
app.use("/api", paperRouter);
app.use("/api/turns", turnsRouter);
app.use("/api/strategies", strategiesRouter);
app.use("/api/datasets", datasetsRouter);
app.use("/api/fs", fsRouter);

// Phase 27 — MCP HTTP transport. Tool handlers run in-process with full
// parent-server access. Claude CLI connects here via --mcp-config.
setTriggerAgent(triggerAgent);
app.post("/mcp", handleMcpRequest);

// Agent adapter test — checks if CLI is available
app.get("/api/agent/test", async (req, res) => {
	const adapter = (req.query.adapter as string) ?? "claude";
	const { exec } = await import("node:child_process");
	const { promisify } = await import("node:util");
	const execAsync = promisify(exec);
	const cmd = adapter === "codex" ? "codex --version" : "claude --version";
	try {
		const { stdout } = await execAsync(cmd, { timeout: config.agent.adapterTestTimeoutMs });
		res.json({ ok: true, version: stdout.trim() });
	} catch {
		res.status(503).json({ ok: false, error: `${adapter} CLI not found` });
	}
});

app.use(errorHandler);

const server = createServer(app);
setupWebSocket(server);

server.listen(port, () => {
	console.log(`QuantDesk server listening on port ${port}`);
	// Boot reconcile must run BEFORE the stale-run cleanup so any
	// in-flight turns from the previous process are marked failed
	// first — otherwise `cleanupStaleAgentRuns` may see a stale
	// running turn and skip posting the "interrupted" comment.
	(async () => {
		try {
			await reconcileOrphanAgentTurns();
		} catch (err) {
			console.error("Turn reconcile failed:", err);
		}
		try {
			await cleanupStaleAgentRuns();
		} catch (err) {
			console.error("Startup cleanup failed:", err);
		}
		try {
			await reconcilePaperSessions();
		} catch (err) {
			console.error("Paper session reconcile failed:", err);
		}
		try {
			await reconcileOrphanScriptContainers();
		} catch (err) {
			console.error("Orphan script reconcile failed:", err);
		}
	})();
	startTurnWatchdog();
});

export { app };
