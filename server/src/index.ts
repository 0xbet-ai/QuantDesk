import { createServer } from "node:http";
import express from "express";
import { errorHandler } from "./middleware/error.js";
import { setupWebSocket } from "./realtime/websocket.js";
import desksRouter from "./routes/desks.js";
import experimentsRouter from "./routes/experiments.js";
import runsRouter from "./routes/runs.js";
import strategiesRouter from "./routes/strategies.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(express.json());

app.get("/api/health", (_req, res) => {
	res.json({ status: "ok" });
});

app.use("/api/desks", desksRouter);
app.use("/api/experiments", experimentsRouter);
app.use("/api/runs", runsRouter);
app.use("/api/strategies", strategiesRouter);

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
});

export { app };
