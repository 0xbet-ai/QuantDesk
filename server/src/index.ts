import { createServer } from "node:http";
import { initDb } from "@quantdesk/db";
import express from "express";
import { handleMcpRequest } from "./mcp/http-route.js";
import { setTriggerAgent } from "./mcp/server.js";
import { errorHandler } from "./middleware/error.js";
import { setupWebSocket } from "./realtime/websocket.js";
import { triggerAgent } from "./services/agent-trigger.js";
import commentsRouter from "./routes/comments.js";
import datasetsRouter from "./routes/datasets.js";
import desksRouter from "./routes/desks.js";
import experimentsRouter from "./routes/experiments.js";
import fsRouter from "./routes/fs.js";
import runsRouter from "./routes/runs.js";
import strategiesRouter from "./routes/strategies.js";
import turnsRouter from "./routes/turns.js";
import {
	cleanupStaleAgentRuns,
	reconcileOrphanAgentTurns,
} from "./services/startup-cleanup.js";
import { startTurnWatchdog } from "./services/turn-watchdog.js";

// Initialise database (starts embedded Postgres on first run if DATABASE_URL is unset)
await initDb();

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(express.json());

app.get("/api/health", (_req, res) => {
	res.json({ status: "ok" });
});

app.use("/api/desks", desksRouter);
app.use("/api/experiments", experimentsRouter);
app.use("/api/comments", commentsRouter);
app.use("/api/runs", runsRouter);
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
		const { stdout } = await execAsync(cmd, { timeout: 5000 });
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
	})();
	startTurnWatchdog();
});

export { app };
