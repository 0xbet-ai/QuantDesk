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

	it("bitvavo + realtime → throws (no nautilus)", () => {
		expect(() => resolveEngine(bitvavo, "realtime")).toThrow(/does not support realtime/);
	});

	it("interactive_brokers + realtime → nautilus", () => {
		expect(resolveEngine(ibkr, "realtime")).toBe("nautilus");
	});

	it("interactive_brokers + classic → throws (no freqtrade)", () => {
		expect(() => resolveEngine(ibkr, "classic")).toThrow(/does not support classic/);
	});

	it("dydx + realtime → nautilus", () => {
		expect(resolveEngine(dydx, "realtime")).toBe("nautilus");
	});

	it("kalshi (generic-only) + generic → generic", () => {
		expect(resolveEngine(kalshi, "generic")).toBe("generic");
	});

	it("kalshi (generic-only) + classic → throws (no freqtrade)", () => {
		expect(() => resolveEngine(kalshi, "classic")).toThrow(/does not support classic/);
	});
});

describe("availableModes", () => {
	it("binance → [classic, realtime]", () => {
		expect(availableModes(binance)).toEqual(["classic", "realtime"]);
	});

	it("bitvavo → [classic]", () => {
		expect(availableModes(bitvavo)).toEqual(["classic"]);
	});

	it("interactive_brokers → [realtime]", () => {
		expect(availableModes(ibkr)).toEqual(["realtime"]);
	});

	it("kalshi (generic-only) → [generic]", () => {
		expect(availableModes(kalshi)).toEqual(["generic"]);
	});
});

describe("availableModesForVenues", () => {
	it("empty venues → every mode", () => {
		expect(availableModesForVenues([])).toEqual(["classic", "realtime", "generic"]);
	});

	it("single binance → both modes", () => {
		expect(availableModesForVenues([binance])).toEqual(["classic", "realtime"]);
	});

	it("binance + bitvavo → intersection = [classic]", () => {
		expect(availableModesForVenues([binance, bitvavo])).toEqual(["classic"]);
	});

	it("binance + ibkr → intersection = [realtime]", () => {
		expect(availableModesForVenues([binance, ibkr])).toEqual(["realtime"]);
	});

	it("bitvavo + ibkr → intersection = [] (incompatible)", () => {
		expect(availableModesForVenues([bitvavo, ibkr])).toEqual([]);
	});

	it("single kalshi → [generic]", () => {
		expect(availableModesForVenues([kalshi])).toEqual(["generic"]);
	});
});
