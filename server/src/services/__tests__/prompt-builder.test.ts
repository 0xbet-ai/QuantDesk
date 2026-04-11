import { describe, expect, it } from "vitest";
import {
	buildAnalystPrompt,
	buildFailureEscalationBlock,
	buildRiskManagerPrompt,
	countRecentFailureStreak,
	estimateTokens,
	trimCommentsToTokenBudget,
} from "../prompt-builder.js";

const desk = {
	name: "BTC Trend Follow",
	budget: "10000",
	targetReturn: "15",
	stopLoss: "5",
	strategyMode: "classic" as const,
	engine: "freqtrade",
	venues: ["binance"],
	description: "BTC/USDT 5m trend following",
};

const realtimeDesk = { ...desk, strategyMode: "realtime" as const, engine: "nautilus" };

const experiment = {
	number: 2,
	title: "RSI Filter Study",
};

const runs = [
	{
		runNumber: 1,
		isBaseline: true,
		result: {
			metrics: [
				{ key: "return", label: "Return", value: 12.3, format: "percent", tone: "positive" },
				{
					key: "drawdown",
					label: "Max Drawdown",
					value: -3.1,
					format: "percent",
					tone: "negative",
				},
				{ key: "win_rate", label: "Win Rate", value: 60, format: "percent" },
				{ key: "trades", label: "Trades", value: 47, format: "integer" },
			],
		},
	},
	{
		runNumber: 2,
		isBaseline: false,
		result: {
			metrics: [
				{ key: "return", label: "Return", value: 15.1, format: "percent", tone: "positive" },
				{
					key: "drawdown",
					label: "Max Drawdown",
					value: -2.8,
					format: "percent",
					tone: "negative",
				},
				{ key: "win_rate", label: "Win Rate", value: 65, format: "percent" },
				{ key: "trades", label: "Trades", value: 52, format: "integer" },
			],
		},
	},
	{ runNumber: 3, isBaseline: false, result: null },
];

const comments = [
	{ author: "user", content: "Try adding RSI filter with period 21" },
	{ author: "analyst", content: "Run #2 done. Return +15.1%, DD -2.8%" },
	{ author: "user", content: "Looks good, now try period 14" },
];

describe("buildAnalystPrompt", () => {
	it("includes desk budget/target/stop-loss values", () => {
		const prompt = buildAnalystPrompt({ desk, experiment, runs, comments, memorySummaries: [] });
		expect(prompt).toContain("10,000");
		expect(prompt).toContain("15%");
		expect(prompt).toContain("5%");
	});

	it('includes "You are working on Experiment #N — {title}"', () => {
		const prompt = buildAnalystPrompt({ desk, experiment, runs, comments, memorySummaries: [] });
		expect(prompt).toContain("Experiment #2");
		expect(prompt).toContain("RSI Filter Study");
	});

	it("includes last 3 run results as structured data", () => {
		const prompt = buildAnalystPrompt({ desk, experiment, runs, comments, memorySummaries: [] });
		expect(prompt).toContain("12.3");
		expect(prompt).toContain("15.1");
		expect(prompt).toContain("baseline");
	});

	it("classic mode prompt is engine-agnostic and calls run_backtest via MCP", () => {
		const prompt = buildAnalystPrompt({ desk, experiment, runs, comments, memorySummaries: [] });
		expect(prompt).toContain("Classic");
		expect(prompt).toContain("candle");
		expect(prompt).toContain("mcp__quantdesk__run_backtest");
		// Engine specifics must NOT leak into the prompt (CLAUDE.md rule #6).
		// The framework contract lives in the seeded strategy.py; the prompt
		// only tells the agent to read it.
		expect(prompt).not.toContain("Freqtrade");
		expect(prompt).not.toContain("freqtrade");
		expect(prompt).not.toContain("IStrategy");
		expect(prompt).not.toContain("populate_indicators");
		// Realtime-specific API must never appear in a classic prompt either.
		expect(prompt).not.toContain("on_quote_tick");
	});

	it("realtime mode prompt is engine-agnostic and calls run_backtest via MCP", () => {
		const prompt = buildAnalystPrompt({
			desk: realtimeDesk,
			experiment,
			runs,
			comments,
			memorySummaries: [],
		});
		expect(prompt).toContain("Real-time");
		expect(prompt).toContain("event");
		expect(prompt).toContain("mcp__quantdesk__run_backtest");
		expect(prompt).not.toContain("Nautilus");
		expect(prompt).not.toContain("nautilus");
		expect(prompt).not.toContain("on_quote_tick");
		expect(prompt).not.toContain("order_factory");
		expect(prompt).not.toContain("populate_indicators");
	});

	it("includes comments", () => {
		const prompt = buildAnalystPrompt({ desk, experiment, runs, comments, memorySummaries: [] });
		expect(prompt).toContain("RSI filter with period 21");
		expect(prompt).toContain("now try period 14");
	});

	it("when memory_summaries exist, they appear before raw comments", () => {
		const summaries = [
			{ level: "desk", content: "Overall desk summary: trend strategy with RSI." },
		];
		const prompt = buildAnalystPrompt({
			desk,
			experiment,
			runs,
			comments,
			memorySummaries: summaries,
		});
		const summaryPos = prompt.indexOf("Overall desk summary");
		const commentPos = prompt.indexOf("RSI filter with period 21");
		expect(summaryPos).toBeGreaterThan(-1);
		expect(commentPos).toBeGreaterThan(-1);
		expect(summaryPos).toBeLessThan(commentPos);
	});
});

describe("buildRiskManagerPrompt", () => {
	const runResult = {
		metrics: [
			{ key: "return", label: "Return", value: 15.1, format: "percent", tone: "positive" },
			{ key: "drawdown", label: "Max Drawdown", value: -2.8, format: "percent", tone: "negative" },
			{ key: "win_rate", label: "Win Rate", value: 65, format: "percent" },
			{ key: "trades", label: "Trades", value: 52, format: "integer" },
		],
	};

	it("includes run result + desk constraints", () => {
		const prompt = buildRiskManagerPrompt({
			desk,
			experiment,
			runNumber: 22,
			runResult,
			runs: [],
			comments: [],
			memorySummaries: [],
		});
		expect(prompt).toContain("15.1");
		expect(prompt).toContain("-2.8");
		expect(prompt).toContain("Run: #22");
		expect(prompt).toContain("Target return");
		expect(prompt).toContain("Stop loss");
	});

	it("injects run history, conversation, and historical checks", () => {
		const priorRuns = [
			{
				runNumber: 1,
				isBaseline: true,
				result: {
					metrics: [
						{ key: "return", label: "Return", value: -5.1, format: "percent" },
						{ key: "trades", label: "Trades", value: 40, format: "integer" },
					],
				},
			},
			{
				runNumber: 2,
				isBaseline: false,
				result: {
					metrics: [
						{ key: "return", label: "Return", value: -4.2, format: "percent" },
						{ key: "trades", label: "Trades", value: 38, format: "integer" },
					],
				},
			},
		];
		const priorComments = [
			{ author: "user", content: "Try an RSI filter." },
			{ author: "analyst", content: "Added RSI<30 gate, running now." },
		];
		const prompt = buildRiskManagerPrompt({
			desk,
			experiment,
			runNumber: 3,
			runResult,
			runs: priorRuns,
			comments: priorComments,
			memorySummaries: [],
		});
		// Run History block present
		expect(prompt).toContain("Run History");
		expect(prompt).toContain("Run #1");
		expect(prompt).toContain("Run #2");
		// Conversation block present
		expect(prompt).toContain("## Conversation");
		expect(prompt).toContain("RSI filter");
		// Historical checks wired into the checklist
		expect(prompt).toContain("Sudden jump");
		expect(prompt).toContain("Repeat submission");
		expect(prompt).toContain("Cherry-picking");
	});
});

describe("trimCommentsToTokenBudget", () => {
	it("with 100 comments, only includes last N that fit within token budget", () => {
		const manyComments = Array.from({ length: 100 }, (_, i) => ({
			author: "user",
			content: `Comment number ${i + 1} with some content to take up space in the token budget.`,
		}));
		const trimmed = trimCommentsToTokenBudget(manyComments, 500);
		expect(trimmed.length).toBeLessThan(100);
		expect(trimmed.length).toBeGreaterThan(0);
		// Should keep the most recent ones
		expect(trimmed[trimmed.length - 1]!.content).toContain("100");
	});
});

describe("estimateTokens", () => {
	it("roughly 1 token per 4 chars", () => {
		const tokens = estimateTokens("hello world"); // 11 chars ~ 3 tokens
		expect(tokens).toBeGreaterThan(1);
		expect(tokens).toBeLessThan(10);
	});
});

describe("countRecentFailureStreak", () => {
	it("returns 0 when there are no comments", () => {
		expect(countRecentFailureStreak([])).toBe(0);
	});

	it("returns 0 when the tail is not a failure system comment", () => {
		expect(
			countRecentFailureStreak([
				{ author: "system", content: "Data-fetch failed for ..." },
				{ author: "analyst", content: "Got it, let me try again." },
			]),
		).toBe(0);
	});

	it("counts consecutive failure system comments at the tail", () => {
		expect(
			countRecentFailureStreak([
				{ author: "user", content: "go" },
				{ author: "system", content: "Data-fetch failed for BTC on hyperliquid" },
				{ author: "system", content: "Backtest request failed: timeout" },
			]),
		).toBe(2);
	});

	it("stops counting at the first non-failure system comment", () => {
		expect(
			countRecentFailureStreak([
				{ author: "system", content: "Data-fetch failed once" },
				{ author: "system", content: "Downloaded BTC/USDT 5m" },
				{ author: "system", content: "Backtest request failed" },
			]),
		).toBe(1);
	});

	it("ignores failures buried before non-system comments", () => {
		expect(
			countRecentFailureStreak([
				{ author: "system", content: "Data-fetch failed once" },
				{ author: "user", content: "what now?" },
			]),
		).toBe(0);
	});

	it("treats neutral progress system comments as transparent so the streak is not broken by them", () => {
		// Phase 14 fix: progress comments like "Downloading..." used to reset
		// the streak counter to 0 between two real failures, which made the
		// escalation block silently undercount.
		expect(
			countRecentFailureStreak([
				{ author: "user", content: "go" },
				{ author: "system", content: "Downloading BTC/USDC 5m..." },
				{ author: "system", content: "Data-fetch failed for BTC/USDC" },
				{ author: "system", content: "Downloading BTC/USDC 1h..." },
				{ author: "system", content: "Data-fetch failed for BTC/USDC" },
			]),
		).toBe(2);
	});

	it("matches both 'failed' and 'error' tokens", () => {
		expect(
			countRecentFailureStreak([{ author: "system", content: "Container error: missing image" }]),
		).toBe(1);
	});
});

describe("buildFailureEscalationBlock", () => {
	it("returns empty string when streak is 0", () => {
		expect(buildFailureEscalationBlock(0)).toBe("");
	});

	it("includes the streak count and persistence pressure when > 0", () => {
		const block = buildFailureEscalationBlock(3);
		expect(block).toContain("RECENT FAILURE STREAK: 3");
		expect(block).toContain("fundamentally");
		expect(block).toContain("Persist.");
	});
});
