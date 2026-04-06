import { describe, expect, it } from "vitest";
import {
	buildAnalyticsPrompt,
	buildRiskManagerPrompt,
	estimateTokens,
	trimCommentsToTokenBudget,
} from "../prompt-builder.js";

const desk = {
	name: "BTC Trend Follow",
	budget: "10000",
	targetReturn: "15",
	stopLoss: "5",
	engine: "freqtrade",
	venues: ["binance"],
	description: "BTC/USDT 5m trend following",
};

const experiment = {
	number: 2,
	title: "RSI Filter Study",
};

const runs = [
	{
		runNumber: 1,
		isBaseline: true,
		result: { returnPct: 12.3, drawdownPct: -3.1, winRate: 0.6, totalTrades: 47 },
	},
	{
		runNumber: 2,
		isBaseline: false,
		result: { returnPct: 15.1, drawdownPct: -2.8, winRate: 0.65, totalTrades: 52 },
	},
	{ runNumber: 3, isBaseline: false, result: null },
];

const comments = [
	{ author: "user", content: "Try adding RSI filter with period 21" },
	{ author: "analytics", content: "Run #2 done. Return +15.1%, DD -2.8%" },
	{ author: "user", content: "Looks good, now try period 14" },
];

describe("buildAnalyticsPrompt", () => {
	it("includes desk budget/target/stop-loss values", () => {
		const prompt = buildAnalyticsPrompt({ desk, experiment, runs, comments, memorySummaries: [] });
		expect(prompt).toContain("10,000");
		expect(prompt).toContain("15%");
		expect(prompt).toContain("5%");
	});

	it('includes "You are working on Experiment #N — {title}"', () => {
		const prompt = buildAnalyticsPrompt({ desk, experiment, runs, comments, memorySummaries: [] });
		expect(prompt).toContain("Experiment #2");
		expect(prompt).toContain("RSI Filter Study");
	});

	it("includes last 3 run results as structured data", () => {
		const prompt = buildAnalyticsPrompt({ desk, experiment, runs, comments, memorySummaries: [] });
		expect(prompt).toContain("12.3");
		expect(prompt).toContain("15.1");
		expect(prompt).toContain("baseline");
	});

	it("instructs agent to use desk's configured engine", () => {
		const prompt = buildAnalyticsPrompt({ desk, experiment, runs, comments, memorySummaries: [] });
		expect(prompt).toContain("freqtrade");
	});

	it("includes comments", () => {
		const prompt = buildAnalyticsPrompt({ desk, experiment, runs, comments, memorySummaries: [] });
		expect(prompt).toContain("RSI filter with period 21");
		expect(prompt).toContain("now try period 14");
	});

	it("when memory_summaries exist, they appear before raw comments", () => {
		const summaries = [
			{ level: "desk", content: "Overall desk summary: trend strategy with RSI." },
		];
		const prompt = buildAnalyticsPrompt({
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
	const runResult = { returnPct: 15.1, drawdownPct: -2.8, winRate: 0.65, totalTrades: 52 };

	it("includes run result + desk constraints", () => {
		const prompt = buildRiskManagerPrompt({ desk, runResult });
		expect(prompt).toContain("15.1");
		expect(prompt).toContain("-2.8");
		expect(prompt).toContain("Target return");
		expect(prompt).toContain("Stop loss");
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
