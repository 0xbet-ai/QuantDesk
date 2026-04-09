/**
 * In-process MCP HTTP endpoint — phases 27b/c/d.
 *
 * The Claude CLI connects here via `--mcp-config` pointing at an HTTP
 * server entry. Running the MCP server in the parent process (instead
 * of a stdio subprocess) gives tool handlers direct access to the
 * parent's DB, event emitter, engine adapters, and `triggerAgent`
 * entry point — no cross-process RPC, no lost WebSocket events.
 *
 * Isolation is per-request: each HTTP call receives a fresh McpServer
 * and a fresh stateless StreamableHTTPServerTransport, with the
 * experiment / desk context parsed from headers the CLI spawn writes
 * into the mcp-config file.
 */
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { db } from "@quantdesk/db";
import { agentTurns } from "@quantdesk/db/schema";
import { and, desc, eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { runWithTurn } from "../services/turn-context.js";
import { createQuantdeskMcpServer } from "./server.js";

export async function handleMcpRequest(req: Request, res: Response): Promise<void> {
	const experimentId = (req.header("x-quantdesk-experiment") ?? "").trim();
	const deskId = (req.header("x-quantdesk-desk") ?? "").trim();
	if (!experimentId || !deskId) {
		res.status(400).json({
			error: "missing X-QuantDesk-Experiment / X-QuantDesk-Desk headers",
		});
		return;
	}
	// Look up the currently-running turn for this experiment so tool side
	// effects (systemComment, run inserts) get stamped with the right
	// turn_id via turn-context AsyncLocalStorage. Without this the tool
	// runs outside runWithTurn and produces orphaned comments that the UI
	// renders as top-level instead of nested inside the turn card.
	const [activeTurn] = await db
		.select()
		.from(agentTurns)
		.where(
			and(eq(agentTurns.experimentId, experimentId), eq(agentTurns.status, "running")),
		)
		.orderBy(desc(agentTurns.startedAt))
		.limit(1);

	const server = createQuantdeskMcpServer({ experimentId, deskId });
	const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
	const handle = async () => {
		await server.connect(transport);
		await transport.handleRequest(req, res, req.body);
	};
	try {
		if (activeTurn) {
			await runWithTurn(activeTurn.id, handle);
		} else {
			await handle();
		}
	} catch (err) {
		console.error("MCP request failed:", err);
		if (!res.headersSent) {
			res.status(500).json({
				error: err instanceof Error ? err.message : "mcp handler error",
			});
		}
	} finally {
		// Best-effort close; stateless transport doesn't keep sockets.
		try {
			await transport.close();
		} catch {
			/* noop */
		}
	}
}
