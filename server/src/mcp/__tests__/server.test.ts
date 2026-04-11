/**
 * Phase 27b/c/d — MCP server tool registration smoke test.
 *
 * Checks the factory wires all lifecycle tools. Handler round-trip tests
 * live closer to the real services (integration tests that touch the DB
 * and engine adapters).
 */
import { describe, expect, it } from "vitest";
import { createQuantdeskMcpServer } from "../server.js";

describe("createQuantdeskMcpServer", () => {
	it("registers every phase 27 tool", () => {
		const server = createQuantdeskMcpServer({
			experimentId: "exp-test",
			deskId: "desk-test",
		});
		const tools = (server as unknown as { _registeredTools: Record<string, unknown> })
			._registeredTools;
		const names = Object.keys(tools).sort();
		expect(names).toEqual(
			[
				"complete_experiment",
				"data_fetch",
				"get_paper_status",
				"go_paper",
				"new_experiment",
				"register_dataset",
				"request_validation",
				"run_backtest",
				"run_script",
				"set_experiment_title",
				"stop_paper",
				"submit_rm_verdict",
			].sort(),
		);
	});
});
