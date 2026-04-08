/**
 * Phase 27b — MCP server tool registration smoke test.
 *
 * Verifies the factory registers the expected tool names. Handler
 * round-trip tests live closer to the real services (integration tests
 * that spin up the DB); this file only checks wiring.
 */
import { describe, expect, it } from "vitest";
import { createQuantdeskMcpServer } from "../server.js";

describe("createQuantdeskMcpServer (27b)", () => {
	it("registers data_fetch and register_dataset", () => {
		const server = createQuantdeskMcpServer({
			experimentId: "exp-test",
			deskId: "desk-test",
		});
		const tools = (server as unknown as { _registeredTools: Record<string, unknown> })
			._registeredTools;
		const names = Object.keys(tools).sort();
		expect(names).toEqual(["data_fetch", "register_dataset"]);
	});
});
