/**
 * Phase 04 — unit tests for the proposal handler registry.
 *
 * The registry itself is pure (no DB) — the DB-touching helpers
 * (`loadComment`, `resolvePendingProposal`) are exercised implicitly via
 * manual integration testing until a full test-DB harness lands.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
	type ProposalHandler,
	extractPendingProposal,
	getProposalHandler,
	registerProposalHandler,
	resetProposalHandlers,
} from "../registry.js";

const stubHandler = (type: ProposalHandler["type"]): ProposalHandler => ({
	type,
	async onApprove() {
		/* no-op */
	},
	async onReject() {
		/* no-op */
	},
});

describe("proposal handler registry", () => {
	afterEach(() => {
		resetProposalHandlers();
	});

	it("getProposalHandler returns undefined for unregistered types", () => {
		expect(getProposalHandler("data_fetch")).toBeUndefined();
	});

	it("registered handler is retrievable by type", () => {
		const handler = stubHandler("data_fetch");
		registerProposalHandler(handler);
		expect(getProposalHandler("data_fetch")).toBe(handler);
	});

	it("duplicate registration throws", () => {
		registerProposalHandler(stubHandler("validation"));
		expect(() => registerProposalHandler(stubHandler("validation"))).toThrow(/already registered/);
	});

	it("resetProposalHandlers clears state between tests", () => {
		registerProposalHandler(stubHandler("new_experiment"));
		resetProposalHandlers();
		expect(getProposalHandler("new_experiment")).toBeUndefined();
	});

	it("unknown proposal type returns undefined (not a crash)", () => {
		expect(getProposalHandler("not_a_real_type")).toBeUndefined();
	});
});

describe("extractPendingProposal", () => {
	it("null metadata → null", () => {
		expect(extractPendingProposal(null)).toBeNull();
	});

	it("missing pendingProposal → null", () => {
		expect(extractPendingProposal({ other: "field" })).toBeNull();
	});

	it("pendingProposal without type → null", () => {
		expect(extractPendingProposal({ pendingProposal: { data: {} } })).toBeNull();
	});

	it("well-formed pendingProposal → returned", () => {
		const result = extractPendingProposal({
			pendingProposal: { type: "data_fetch", data: { foo: "bar" } },
		});
		expect(result).toEqual({ type: "data_fetch", data: { foo: "bar" } });
	});

	it("pendingProposal with wrong type shape (number) → null", () => {
		expect(extractPendingProposal({ pendingProposal: { type: 42, data: {} } })).toBeNull();
	});
});
