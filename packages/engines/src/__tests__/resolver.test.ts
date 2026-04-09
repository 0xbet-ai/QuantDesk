import { describe, expect, it } from "vitest";
import { availableModes, availableModesForVenues, resolveEngine } from "../resolver.js";

const binance = { id: "binance", name: "Binance", engines: ["freqtrade", "nautilus"] };
const bitvavo = { id: "bitvavo", name: "Bitvavo", engines: ["freqtrade"] };
const ibkr = {
	id: "interactive_brokers",
	name: "Interactive Brokers",
	engines: ["nautilus"],
};
const kalshi = { id: "kalshi", name: "Kalshi", engines: ["generic"] };
const dydx = { id: "dydx", name: "dYdX", engines: ["nautilus"] };

describe("resolveEngine", () => {
	it("binance + classic → freqtrade", () => {
		expect(resolveEngine(binance, "classic")).toBe("freqtrade");
	});

	it("binance + realtime → nautilus", () => {
		expect(resolveEngine(binance, "realtime")).toBe("nautilus");
	});

	it("bitvavo + classic → freqtrade", () => {
		expect(resolveEngine(bitvavo, "classic")).toBe("freqtrade");
	});

	it("bitvavo + realtime → generic (no nautilus, auto-fallback)", () => {
		expect(resolveEngine(bitvavo, "realtime")).toBe("generic");
	});

	it("interactive_brokers + realtime → nautilus", () => {
		expect(resolveEngine(ibkr, "realtime")).toBe("nautilus");
	});

	it("interactive_brokers + classic → generic (no freqtrade, auto-fallback)", () => {
		expect(resolveEngine(ibkr, "classic")).toBe("generic");
	});

	it("dydx + realtime → nautilus", () => {
		expect(resolveEngine(dydx, "realtime")).toBe("nautilus");
	});

	it("kalshi (no managed engine) + classic → generic", () => {
		expect(resolveEngine(kalshi, "classic")).toBe("generic");
	});

	it("kalshi (no managed engine) + realtime → generic", () => {
		expect(resolveEngine(kalshi, "realtime")).toBe("generic");
	});
});

describe("availableModes", () => {
	it("binance → [classic, realtime]", () => {
		expect(availableModes(binance)).toEqual(["classic", "realtime"]);
	});

	it("bitvavo → [classic, realtime] (realtime auto-falls-back to generic)", () => {
		expect(availableModes(bitvavo)).toEqual(["classic", "realtime"]);
	});

	it("interactive_brokers → [classic, realtime]", () => {
		expect(availableModes(ibkr)).toEqual(["classic", "realtime"]);
	});

	it("kalshi (no managed engine) → [classic, realtime]", () => {
		expect(availableModes(kalshi)).toEqual(["classic", "realtime"]);
	});
});

describe("availableModesForVenues", () => {
	it("empty venues → every mode", () => {
		expect(availableModesForVenues([])).toEqual(["classic", "realtime"]);
	});

	it("single binance → both modes", () => {
		expect(availableModesForVenues([binance])).toEqual(["classic", "realtime"]);
	});

	it("binance + bitvavo → both modes (generic fallback covers realtime)", () => {
		expect(availableModesForVenues([binance, bitvavo])).toEqual(["classic", "realtime"]);
	});

	it("bitvavo + ibkr → both modes", () => {
		expect(availableModesForVenues([bitvavo, ibkr])).toEqual(["classic", "realtime"]);
	});

	it("kalshi → both modes", () => {
		expect(availableModesForVenues([kalshi])).toEqual(["classic", "realtime"]);
	});
});
