/**
 * Phase 08 — RM verdict marker parser unit tests.
 */

import { describe, expect, it } from "vitest";
import { extractRmVerdict } from "../agent-trigger.js";

describe("extractRmVerdict", () => {
	it("returns null when neither marker is present", () => {
		expect(extractRmVerdict("Just analysis text, no verdict.")).toBeNull();
	});

	it("parses [RM_APPROVE] alone", () => {
		const text = "Looks solid.\n[RM_APPROVE]";
		expect(extractRmVerdict(text)).toEqual({ verdict: "approve", reason: "" });
	});

	it("parses [RM_REJECT] with a reason", () => {
		const text = "Suspicious sharpe.\n[RM_REJECT] Sharpe > 5 is a red flag";
		expect(extractRmVerdict(text)).toEqual({
			verdict: "reject",
			reason: "Sharpe > 5 is a red flag",
		});
	});

	it("approve takes precedence if both somehow appear", () => {
		const text = "[RM_APPROVE]\n[RM_REJECT] not really";
		expect(extractRmVerdict(text)).toEqual({ verdict: "approve", reason: "" });
	});

	it("ignores markers not at the start of a line", () => {
		expect(extractRmVerdict("blabla [RM_APPROVE] inline")).toBeNull();
	});

	it("trims leading whitespace from the reason", () => {
		expect(extractRmVerdict("[RM_REJECT]    too good to be true")).toEqual({
			verdict: "reject",
			reason: "too good to be true",
		});
	});
});
