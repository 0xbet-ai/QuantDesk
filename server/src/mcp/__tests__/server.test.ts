/**
 * Phase 27a scaffold smoke test.
 *
 * Asserts that the MCP server factory produces a server with zero tools
 * registered. Later slices will extend this to exercise each tool
 * handler via the SDK's in-memory client/server pair.
 */
import { describe, expect, it } from "vitest";
import { createQuantdeskMcpServer } from "../server.js";

describe("createQuantdeskMcpServer (27a scaffold)", () => {
	it("constructs a server with zero tools", () => {
		const server = createQuantdeskMcpServer({
			experimentId: "exp-test",
			deskId: "desk-test",
		});
		// The `server` field is the low-level Server; the high-level
		// McpServer's _registeredTools is a private map. We access it via
		// the documented `.server` escape hatch and count entries on the
		// private registry via a cast — this is a scaffold assertion that
		// will be replaced in 27b with a real list_tools round-trip.
		const tools = (server as unknown as { _registeredTools: Record<string, unknown> })
			._registeredTools;
		expect(Object.keys(tools)).toHaveLength(0);
	});
});
