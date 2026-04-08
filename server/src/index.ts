import { createServer } from "node:http";
import { initDb } from "@quantdesk/db";
import express from "express";
import { errorHandler } from "./middleware/error.js";
import { setupWebSocket } from "./realtime/websocket.js";
import commentsRouter from "./routes/comments.js";
import datasetsRouter from "./routes/datasets.js";
import desksRouter from "./routes/desks.js";
import experimentsRouter from "./routes/experiments.js";
import fsRouter from "./routes/fs.js";
import runsRouter from "./routes/runs.js";
import strategiesRouter from "./routes/strategies.js";
import { registerAllProposalHandlers } from "./services/proposal-handlers/index.js";
import { cleanupStaleAgentRuns } from "./services/startup-cleanup.js";

// Initialise database (starts embedded Postgres on first run if DATABASE_URL is unset)
await initDb();

// Register every proposal handler at boot (data-fetch, and once phases
// 05–07/11 land, the other four). The generic /api/comments/:id/approve
// router dispatches via this registry.
registerAllProposalHandlers();

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
app.use("/api/strategies", strategiesRouter);
app.use("/api/datasets", datasetsRouter);
app.use("/api/fs", fsRouter);

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
	// Clean up any stale agent runs from a previous crash/restart
	cleanupStaleAgentRuns().catch((err) => {
		console.error("Startup cleanup failed:", err);
	});
});

export { app };
