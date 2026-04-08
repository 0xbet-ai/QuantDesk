/**
 * QuantDesk MCP server — phase 27a scaffold.
 *
 * Zero-tool MCP server the agent CLI will connect to. Tools are added in
 * later slices (27b onward). The factory takes the runtime context the
 * tool handlers will need so that later slices don't have to touch this
 * entry point, only the tool registration block.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface McpServerContext {
	/** The experiment this agent turn is operating on. */
	experimentId: string;
	/** Used by tool handlers to publish progress events back to the UI. */
	deskId: string;
}

export function createQuantdeskMcpServer(_ctx: McpServerContext): McpServer {
	const server = new McpServer(
		{
			name: "quantdesk",
			version: "0.0.1",
		},
		{
			capabilities: {
				tools: {},
			},
		},
	);

	// Tools are registered here starting in phase 27b.
	// See doc/plans/27_mcp_migration.md for the full roadmap.

	return server;
}
