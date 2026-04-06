import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getAgentAdapter } from "../registry.js";

const fixturesDir = resolve(import.meta.dirname, "fixtures");

describe("adapter registry", () => {
	it('returns Claude adapter for "claude"', () => {
		expect(getAgentAdapter("claude").name).toBe("claude");
	});

	it('returns Codex adapter for "codex"', () => {
		expect(getAgentAdapter("codex").name).toBe("codex");
	});

	it("throws for unknown adapter", () => {
		expect(() => getAgentAdapter("gpt")).toThrow("Unknown agent adapter: gpt");
	});
});

describe("Claude adapter", () => {
	const adapter = getAgentAdapter("claude");
	const fixture = readFileSync(resolve(fixturesDir, "claude-stream.jsonl"), "utf-8");
	const lines = fixture.trim().split("\n");

	it("parseOutputStream extracts sessionId, usage.tokens, resultText", () => {
		const result = adapter.parseOutputStream(lines);
		expect(result.sessionId).toBe("aa5defe3-f519-40f0-8fdf-38644707da55");
		expect(result.resultText).toBe("I'll analyze the strategy and run a backtest.");
		expect(result.usage.inputTokens).toBe(1500);
		expect(result.usage.outputTokens).toBe(42);
		expect(result.usage.costUsd).toBe(0.053);
	});

	it("sessionId provided → --resume flag in spawn args", () => {
		const args = adapter.buildSpawnArgs("test prompt", "session-123");
		expect(args).toContain("--resume");
		expect(args).toContain("session-123");
	});

	it("sessionId is null → no resume flag", () => {
		const args = adapter.buildSpawnArgs("test prompt");
		expect(args).not.toContain("--resume");
	});
});

describe("Codex adapter", () => {
	const adapter = getAgentAdapter("codex");
	const fixture = readFileSync(resolve(fixturesDir, "codex-stream.jsonl"), "utf-8");
	const lines = fixture.trim().split("\n");

	it("parseOutputStream extracts threadId, usage, summary", () => {
		const result = adapter.parseOutputStream(lines);
		expect(result.sessionId).toBe("019d6039-8675-7241-9e79-cbfcbcb3fd44");
		expect(result.resultText).toBe("I'll analyze the strategy and run a backtest.");
		expect(result.usage.inputTokens).toBe(14972);
		expect(result.usage.outputTokens).toBe(33);
	});

	it("threadId provided → resume {threadId} in spawn args", () => {
		const args = adapter.buildSpawnArgs("test prompt", "thread-456");
		expect(args).toContain("resume");
		expect(args).toContain("thread-456");
	});

	it("sessionId is null → fresh session", () => {
		const args = adapter.buildSpawnArgs("test prompt");
		expect(args).not.toContain("resume");
	});
});
