import { describe, expect, it } from "vitest";
import {
	assignBaseline,
	autoIncrementExperimentNumber,
	calculateRunDelta,
	filterStrategiesByEngine,
	validateGoPaper,
	validateStop,
} from "../services/logic.js";

describe("baseline assignment", () => {
	it("first run in an experiment automatically gets is_baseline=true", () => {
		const result = assignBaseline(0);
		expect(result).toBe(true);
	});

	it("subsequent runs get is_baseline=false", () => {
		expect(assignBaseline(1)).toBe(false);
		expect(assignBaseline(5)).toBe(false);
	});
});

describe("experiment number auto-increment", () => {
	it("create 3 → numbers are 1, 2, 3", () => {
		expect(autoIncrementExperimentNumber(0)).toBe(1);
		expect(autoIncrementExperimentNumber(1)).toBe(2);
		expect(autoIncrementExperimentNumber(2)).toBe(3);
	});

	it("first experiment in desk is 1", () => {
		expect(autoIncrementExperimentNumber(0)).toBe(1);
	});
});

describe("run delta calculation", () => {
	const baseline = { returnPct: 12.3, drawdownPct: -3.1, winRate: 0.6 };
	const current = { returnPct: 15.1, drawdownPct: -2.8, winRate: 0.65 };

	it("produces correct return/drawdown/winrate diff", () => {
		const delta = calculateRunDelta(current, baseline);
		expect(delta).not.toBeNull();
		expect(delta!.returnPctDelta).toBeCloseTo(2.8);
		expect(delta!.drawdownPctDelta).toBeCloseTo(0.3);
		expect(delta!.winRateDelta).toBeCloseTo(0.05);
	});

	it("returns null deltas for baseline run", () => {
		const delta = calculateRunDelta(baseline, null);
		expect(delta).toBeNull();
	});
});

describe("strategy catalog filtering", () => {
	const catalog = [
		{ id: "ft_1", engine: "freqtrade", name: "ADX" },
		{ id: "ft_2", engine: "freqtrade", name: "RSI" },
		{ id: "hb_1", engine: "hummingbot", name: "MM" },
		{ id: "nt_1", engine: "nautilus", name: "HFT" },
	];

	it("GET /api/strategies?engine=freqtrade returns only freqtrade strategies", () => {
		const result = filterStrategiesByEngine(catalog, "freqtrade");
		expect(result).toHaveLength(2);
		expect(result.every((s) => s.engine === "freqtrade")).toBe(true);
	});

	it("no filter returns all", () => {
		const result = filterStrategiesByEngine(catalog, undefined);
		expect(result).toHaveLength(4);
	});
});

describe("go-paper validation", () => {
	it("POST /api/runs/:id/go-paper on a non-completed run → error", () => {
		expect(() => validateGoPaper({ status: "running", mode: "backtest" })).toThrow();
		expect(() => validateGoPaper({ status: "pending", mode: "backtest" })).toThrow();
	});

	it("completed backtest run → ok", () => {
		expect(() => validateGoPaper({ status: "completed", mode: "backtest" })).not.toThrow();
	});

	it("already paper run → error", () => {
		expect(() => validateGoPaper({ status: "completed", mode: "paper" })).toThrow();
	});
});

describe("stop validation", () => {
	it("POST /api/runs/:id/stop on a non-paper run → error", () => {
		expect(() => validateStop({ status: "completed", mode: "backtest" })).toThrow();
		expect(() => validateStop({ status: "pending", mode: "backtest" })).toThrow();
	});

	it("running paper run → ok", () => {
		expect(() => validateStop({ status: "running", mode: "paper" })).not.toThrow();
	});
});
