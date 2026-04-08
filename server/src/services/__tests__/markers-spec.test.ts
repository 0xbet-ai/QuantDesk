/**
 * Phase 03 — spec-as-source-of-truth lint over `doc/agent/MARKERS.md`.
 *
 * The spec used to have two categories (Action vs Proposal); under
 * CLAUDE.md rule #15 "Approval is conversational" the category was
 * collapsed — every marker is an action marker, and consent-requiring
 * actions are expected to be gated socially by a prior plain-text
 * exchange.
 *
 * Three layers still apply:
 *  (1) parser unit tests — the format is fixed; assert it parses cleanly.
 *  (2) coverage — every marker the spec defines must appear in the code
 *      (parser or dispatcher), and every code marker must appear in the
 *      spec.
 *  (3) branch ↔ user_next_action — every branch listed for a marker must
 *      have a corresponding user_next_action entry, and vice versa, so
 *      the spec cannot drift away from the dispatcher and the rule #14
 *      invariant.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadMarkersSpec, parseMarkersSpec } from "../markers-spec.js";

// __dirname is server/src/services/__tests__ — repo root is four levels up.
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

const EXPECTED_MARKERS = [
	"DATA_FETCH",
	"DATASET",
	"RUN_BACKTEST",
	"BACKTEST_RESULT",
	"VALIDATION",
	"NEW_EXPERIMENT",
	"COMPLETE_EXPERIMENT",
	"GO_PAPER",
	"RUN_PAPER",
	"EXPERIMENT_TITLE",
];

describe("markers-spec parser", () => {
	const parsed = loadMarkersSpec();
	const byName = new Map(parsed.map((m) => [m.name, m]));

	it("parses every expected marker from MARKERS.md", () => {
		const found = parsed.map((m) => m.name).sort();
		expect(found).toEqual([...EXPECTED_MARKERS].sort());
	});

	it("every marker has at least one branch listed", () => {
		// Markers where a single deterministic outcome is the whole story
		// — no failure branch worth documenting because the effect is a
		// plain DB write.
		const noBranchExpected = new Set([
			"DATASET",
			"BACKTEST_RESULT",
			"EXPERIMENT_TITLE",
			"NEW_EXPERIMENT",
			"COMPLETE_EXPERIMENT",
		]);
		const markersWithoutBranches: string[] = [];
		for (const m of parsed) {
			if (m.branches.length === 0) {
				if (noBranchExpected.has(m.name)) continue;
				markersWithoutBranches.push(m.name);
			}
		}
		expect(markersWithoutBranches).toEqual([]);
	});

	it("every branch has a corresponding user_next_action entry", () => {
		const violations: string[] = [];
		for (const m of parsed) {
			// EXPERIMENT_TITLE has a single inline user_next_action
			// that does not enumerate per-branch entries — its branches
			// are metadata-only and the marker is documented as never
			// being a turn boundary.
			if (m.name === "EXPERIMENT_TITLE") continue;
			for (const branch of m.branches) {
				if (!(branch in m.userNextActions)) {
					violations.push(`${m.name}/${branch}`);
				}
			}
		}
		expect(violations).toEqual([]);
	});

	it("RUN_BACKTEST has the success / engine_failure / refusal_no_data branches", () => {
		const m = byName.get("RUN_BACKTEST");
		expect(m).toBeDefined();
		expect(m?.branches).toEqual(
			expect.arrayContaining(["success", "engine_failure", "refusal_no_data"]),
		);
	});

	it("DATA_FETCH has cache_hit / cache_miss / failure branches", () => {
		const m = byName.get("DATA_FETCH");
		expect(m).toBeDefined();
		expect(m?.branches).toEqual(
			expect.arrayContaining(["cache_hit", "cache_miss_success", "download_failure"]),
		);
	});
});

describe("markers-spec ↔ code coverage", () => {
	const parsed = loadMarkersSpec();
	const codeFiles = [
		readFileSync(join(REPO_ROOT, "server/src/services/agent-trigger.ts"), "utf8"),
		readFileSync(join(REPO_ROOT, "packages/shared/src/agent-markers.ts"), "utf8"),
	].join("\n");

	it("every marker in MARKERS.md is referenced from server code or shared parser", () => {
		const violations: string[] = [];
		for (const m of parsed) {
			if (!codeFiles.includes(m.name)) {
				violations.push(m.name);
			}
		}
		expect(violations).toEqual([]);
	});
});

describe("parseMarkersSpec — minimal fixture", () => {
	it("parses an inline-form branches line", () => {
		const md = [
			"```",
			"FOO(x: number)",
			"  requires:  —",
			"  effect:    frobnicate",
			"  branches:  - a / - b / - c",
			"  user_next_action:",
			"             a  → do a",
			"             b  → do b",
			"             c  → do c",
			"```",
		].join("\n");
		const parsed = parseMarkersSpec(md);
		expect(parsed).toHaveLength(1);
		expect(parsed[0]?.name).toBe("FOO");
		expect(parsed[0]?.branches).toEqual(["a", "b", "c"]);
	});
});
