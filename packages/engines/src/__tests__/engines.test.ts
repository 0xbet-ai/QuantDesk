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

	it("derives metrics uniformly from trades via deriveMetrics()", () => {
		const result = adapter.parseResult(fixture);
		// Fixture has 2 trades: pnl=102 + pnl=-69 = 33 total. wallet=10000.
		// returnPct = 33/10000 * 100 = 0.33%
		// drawdownPct: equity goes 10000→10102→10033, peak=10102, dd=(10102-10033)/10102≈0.68%
		// winRate = 1 win / 2 trades = 0.5
		// totalTrades = 2 (from actual trade list, not the fixture's stale "47")
		expect(result.returnPct).toBeCloseTo(0.33);
		expect(result.drawdownPct).toBeLessThan(0); // negative
		expect(result.winRate).toBeCloseTo(0.5);
		expect(result.totalTrades).toBe(2);
	});

	it("flattens each closed round-trip into open + close events on the trade tape", () => {
		const result = adapter.parseResult(fixture);
		// 2 round-trips → 4 events
		expect(result.trades).toHaveLength(4);
		const open = result.trades[0]!;
		expect(open.time).toBe("2025-01-15 10:30:00");
		expect(open.side).toBe("buy");
		expect(open.price).toBe(42150.5);
		expect(open.amount).toBe(0.237);
		expect(open.metadata).toMatchObject({ pair: "BTC/USDT", leg: "open" });
		const close = result.trades[1]!;
		expect(close.time).toBe("2025-01-15 11:45:00");
		expect(close.side).toBe("sell");
		expect(close.metadata).toMatchObject({ pair: "BTC/USDT", leg: "close", pnl: 102 });
	});

	it("throws with meaningful message on error output", () => {
		expect(() => adapter.parseResult("ERROR: strategy not found")).toThrow("Failed to parse");
	});
});

describe("nautilus parseResult", () => {
	const adapter = getAdapter("nautilus");
	const fixture = readFileSync(resolve(fixturesDir, "nautilus-result.json"), "utf-8");

	it("derives metrics uniformly from trades via deriveMetrics()", () => {
		const result = adapter.parseResult(fixture);
		// Same fixture shape as freqtrade: 2 trades, PnL 102 + -69 = 33.
		expect(result.returnPct).toBeCloseTo(0.33);
		expect(result.drawdownPct).toBeLessThan(0);
		expect(result.winRate).toBeCloseTo(0.5);
		expect(result.totalTrades).toBe(2);
	});

	it("flattens each round-trip into open + close events on the trade tape", () => {
		const result = adapter.parseResult(fixture);
		expect(result.trades).toHaveLength(4);
		const open = result.trades[0]!;
		expect(open.side).toBe("buy");
		expect(open.price).toBe(42150.5);
		expect(open.metadata).toMatchObject({ pair: "BTC/USDT", leg: "open" });
	});

	it("throws with meaningful message on error output", () => {
		expect(() => adapter.parseResult("CRASH")).toThrow("Failed to parse");
	});
});

describe("generic parseResult", () => {
	const adapter = getAdapter("generic");

	it("derives stats from event-tape metadata.pnl", () => {
		const json = JSON.stringify({
			trades: [
				{
					time: "2025-01-01T00:00:00Z",
					side: "buy",
					price: 40000,
					amount: 0.5,
					metadata: { pair: "BTC/USDT" },
				},
				{
					time: "2025-01-02T00:00:00Z",
					side: "sell",
					price: 40400,
					amount: 0.5,
					metadata: { pair: "BTC/USDT", pnl: 200 },
				},
				{
					time: "2025-01-03T00:00:00Z",
					side: "buy",
					price: 41000,
					amount: 0.5,
					metadata: { pair: "BTC/USDT" },
				},
				{
					time: "2025-01-04T00:00:00Z",
					side: "sell",
					price: 40900,
					amount: 0.5,
					metadata: { pair: "BTC/USDT", pnl: -50 },
				},
			],
		});
		const result = adapter.parseResult(json);
		// PnL events: +200, -50 → totalPnl=150, wallet=10000, return=1.5%
		expect(result.returnPct).toBeCloseTo(1.5);
		expect(result.totalTrades).toBe(2);
		expect(result.winRate).toBeCloseTo(0.5);
		expect(result.drawdownPct).toBeLessThan(0);
		expect(result.trades).toHaveLength(4);
	});

	it("throws when trades array is empty or missing", () => {
		const json = JSON.stringify({ returnPct: 15.2, totalTrades: 120 });
		expect(() => adapter.parseResult(json)).toThrow("must include a `trades` array");
	});

	it("throws with meaningful message on non-JSON stdout", () => {
		expect(() => adapter.parseResult("not json at all")).toThrow("must output JSON");
	});
});
