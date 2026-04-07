import { describe, expect, it } from "vitest";
import { detectProposals } from "../triggers.js";

describe("proposal marker detection", () => {
	it("detects [PROPOSE_VALIDATION]", () => {
		const text = "Results look unusual.\n[PROPOSE_VALIDATION]\nLet me know.";
		const proposals = detectProposals(text);
		expect(proposals).toHaveLength(1);
		expect(proposals[0]!.type).toBe("PROPOSE_VALIDATION");
		expect(proposals[0]!.value).toBe("");
	});

	it("detects [PROPOSE_NEW_EXPERIMENT] with title", () => {
		const text = "This is a different direction.\n[PROPOSE_NEW_EXPERIMENT] RSI Divergence Study";
		const proposals = detectProposals(text);
		expect(proposals).toHaveLength(1);
		expect(proposals[0]!.type).toBe("PROPOSE_NEW_EXPERIMENT");
		expect(proposals[0]!.value).toBe("RSI Divergence Study");
	});

	it("detects [PROPOSE_COMPLETE_EXPERIMENT]", () => {
		const text = "This experiment has converged.\n[PROPOSE_COMPLETE_EXPERIMENT]";
		const proposals = detectProposals(text);
		expect(proposals).toHaveLength(1);
		expect(proposals[0]!.type).toBe("PROPOSE_COMPLETE_EXPERIMENT");
	});

	it("detects [PROPOSE_GO_PAPER] with runId", () => {
		const text = "Backtest looks solid.\n[PROPOSE_GO_PAPER] run-abc-123";
		const proposals = detectProposals(text);
		expect(proposals).toHaveLength(1);
		expect(proposals[0]!.type).toBe("PROPOSE_GO_PAPER");
		expect(proposals[0]!.value).toBe("run-abc-123");
	});

	it("detects multiple proposals in one message", () => {
		const text = "[PROPOSE_NEW_EXPERIMENT] Timeframe Study\nSome text\n[PROPOSE_VALIDATION]";
		const proposals = detectProposals(text);
		expect(proposals).toHaveLength(2);
	});

	it("returns empty array when no proposals", () => {
		const text = "Just a normal response with no markers.";
		const proposals = detectProposals(text);
		expect(proposals).toHaveLength(0);
	});

	it("ignores markers not at start of line", () => {
		const text = "I think [PROPOSE_VALIDATION] might be needed";
		const proposals = detectProposals(text);
		expect(proposals).toHaveLength(0);
	});
});
