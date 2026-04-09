import { describe, expect, it, vi } from "vitest";
import { AgentRunner } from "../agent-runner.js";

// Mock adapter that returns canned responses
const mockAdapter = {
	name: "claude",
	buildSpawnArgs: vi.fn((_prompt: string, sessionId?: string) => {
		const args = ["claude", "--print", "-"];
		if (sessionId) args.push("--resume", sessionId);
		return args;
	}),
	parseStreamLine: vi.fn(() => null),
	parseOutputStream: vi.fn(() => ({
		sessionId: "session-abc",
		resultText: "I ran a backtest. Return +12.3%, DD -3.1%. Run #1 complete.",
		usage: { inputTokens: 1500, outputTokens: 42 },
	})),
};

// Mock spawn function
const mockSpawn = vi.fn(async (_args: string[], _stdin: string) => [
	'{"type":"system","session_id":"session-abc"}',
	'{"type":"result","result":"test","session_id":"session-abc","usage":{"input_tokens":1500,"output_tokens":42}}',
]);

describe("AgentRunner", () => {
	const runner = new AgentRunner(mockAdapter, mockSpawn);

	it("user comment → agent spawned with prompt including that comment", async () => {
		const result = await runner.run({
			desk: {
				name: "Test",
				budget: "10000",
				targetReturn: "15",
				stopLoss: "5",
				strategyMode: "classic" as const,
				engine: "freqtrade",
				venues: ["binance"],
				description: null,
			},
			experiment: { number: 1, title: "Baseline" },
			runs: [],
			comments: [{ author: "user", content: "Run a 5m BTC/USDT backtest" }],
			memorySummaries: [],
			sessionId: undefined,
			agentRole: "analyst",
		});

		expect(mockSpawn).toHaveBeenCalled();
		const stdinArg = mockSpawn.mock.calls[0]![1];
		expect(stdinArg).toContain("5m BTC/USDT backtest");
		expect(result.sessionId).toBe("session-abc");
		expect(result.resultText).toContain("backtest");
	});

	it("second comment on same desk → --resume with previous sessionId", async () => {
		mockSpawn.mockClear();
		mockAdapter.buildSpawnArgs.mockClear();

		await runner.run({
			desk: {
				name: "Test",
				budget: "10000",
				targetReturn: "15",
				stopLoss: "5",
				strategyMode: "classic" as const,
				engine: "freqtrade",
				venues: ["binance"],
				description: null,
			},
			experiment: { number: 1, title: "Baseline" },
			runs: [],
			comments: [{ author: "user", content: "Try RSI filter" }],
			memorySummaries: [],
			sessionId: "session-prev",
			agentRole: "analyst",
		});

		expect(mockAdapter.buildSpawnArgs).toHaveBeenCalledWith(
			expect.any(String),
			"session-prev",
			undefined,
			undefined,
		);
		const args = mockAdapter.buildSpawnArgs.mock.results[0]!.value;
		expect(args).toContain("--resume");
		expect(args).toContain("session-prev");
	});

	it("agent error → result includes error", async () => {
		const errorSpawn = vi.fn(async () => {
			throw new Error("CLI crashed");
		});
		const errorRunner = new AgentRunner(mockAdapter, errorSpawn);

		const result = await errorRunner.run({
			desk: {
				name: "Test",
				budget: "10000",
				targetReturn: "15",
				stopLoss: "5",
				strategyMode: "classic" as const,
				engine: "freqtrade",
				venues: ["binance"],
				description: null,
			},
			experiment: { number: 1, title: "Baseline" },
			runs: [],
			comments: [{ author: "user", content: "test" }],
			memorySummaries: [],
			sessionId: undefined,
			agentRole: "analyst",
		});

		expect(result.error).toBe("CLI crashed");
		expect(result.resultText).toBe("");
	});
});
