import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getAdapter } from "../registry.js";

const fixturesDir = resolve(import.meta.dirname, "fixtures");

describe("engine registry", () => {
	it('getAdapter("freqtrade") → FreqtradeAdapter instance', () => {
		const adapter = getAdapter("freqtrade");
		expect(adapter.name).toBe("freqtrade");
	});

	it('getAdapter("nautilus") → NautilusAdapter instance', () => {
		expect(getAdapter("nautilus").name).toBe("nautilus");
	});

	it('getAdapter("generic") → GenericAdapter instance', () => {
		expect(getAdapter("generic").name).toBe("generic");
	});

	it('getAdapter("unknown") → throws', () => {
		expect(() => getAdapter("unknown")).toThrow("Unknown engine: unknown");
	});
});

describe("freqtrade parseResult", () => {
	const adapter = getAdapter("freqtrade");
	const fixture = readFileSync(resolve(fixturesDir, "freqtrade-result.json"), "utf-8");

	it("parses correct returnPct, drawdownPct, winRate, totalTrades", () => {
		const result = adapter.parseResult(fixture);
		expect(result.returnPct).toBeCloseTo(12.3);
		expect(result.drawdownPct).toBeCloseTo(-3.1);
		expect(result.winRate).toBeCloseTo(0.65);
		expect(result.totalTrades).toBe(47);
	});

	it("extracts individual TradeEntry[] with pair, side, price, amount, pnl, timestamps", () => {
		const result = adapter.parseResult(fixture);
		expect(result.trades).toHaveLength(2);
		const t = result.trades[0]!;
		expect(t.pair).toBe("BTC/USDT");
		expect(t.side).toBe("buy");
		expect(t.price).toBe(42150.5);
		expect(t.amount).toBe(0.237);
		expect(t.pnl).toBe(102.0);
		expect(t.openedAt).toBe("2025-01-15 10:30:00");
		expect(t.closedAt).toBe("2025-01-15 11:45:00");
	});

	it("throws with meaningful message on error output", () => {
		expect(() => adapter.parseResult("ERROR: strategy not found")).toThrow("Failed to parse");
	});
});

describe("nautilus parseResult", () => {
	const adapter = getAdapter("nautilus");
	const fixture = readFileSync(resolve(fixturesDir, "nautilus-result.json"), "utf-8");

	it("parses correct NormalizedResult", () => {
		const result = adapter.parseResult(fixture);
		expect(result.returnPct).toBeCloseTo(12.3);
		expect(result.drawdownPct).toBeCloseTo(-3.1);
		expect(result.winRate).toBeCloseTo(0.65);
		expect(result.totalTrades).toBe(47);
	});

	it("extracts TradeEntry[] from nautilus format", () => {
		const result = adapter.parseResult(fixture);
		expect(result.trades).toHaveLength(2);
		const t = result.trades[0]!;
		expect(t.pair).toBe("BTC/USDT");
		expect(t.side).toBe("buy");
		expect(t.price).toBe(42150.5);
	});

	it("throws with meaningful message on error output", () => {
		expect(() => adapter.parseResult("CRASH")).toThrow("Failed to parse");
	});
});

describe("generic parseResult", () => {
	const adapter = getAdapter("generic");

	it("parses stdout JSON → NormalizedResult", () => {
		const json = JSON.stringify({
			returnPct: 15.2,
			drawdownPct: -4.5,
			winRate: 0.68,
			totalTrades: 120,
			trades: [],
		});
		const result = adapter.parseResult(json);
		expect(result.returnPct).toBe(15.2);
		expect(result.totalTrades).toBe(120);
	});

	it("throws with meaningful message on non-JSON stdout", () => {
		expect(() => adapter.parseResult("not json at all")).toThrow("must output JSON");
	});
});
