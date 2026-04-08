/**
 * Stdio entry point — phase 27a scaffold.
 *
 * The Claude CLI subprocess spawns this file as its own child process and
 * speaks MCP over stdin/stdout. The experiment / desk context comes in via
 * environment variables set by the parent `triggerAgent` call site; this
 * is the cleanest way to pass per-turn context into a subprocess that the
 * CLI owns the spawn of.
 *
 * Not yet wired into the agent CLI spawn path — that happens in phase 27b
 * once there is at least one tool worth calling. For now this file exists
 * so the scaffold test can import and exercise the server factory.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createQuantdeskMcpServer } from "./server.js";

async function main(): Promise<void> {
	const experimentId = process.env.QUANTDESK_MCP_EXPERIMENT_ID;
	const deskId = process.env.QUANTDESK_MCP_DESK_ID;
	if (!experimentId || !deskId) {
		console.error("stdio-entry: QUANTDESK_MCP_EXPERIMENT_ID and QUANTDESK_MCP_DESK_ID must be set");
		process.exit(1);
	}
	const server = createQuantdeskMcpServer({ experimentId, deskId });
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

// Only run when invoked directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((err) => {
		console.error("stdio-entry fatal:", err);
		process.exit(1);
	});
}
