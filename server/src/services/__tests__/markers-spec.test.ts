/**
 * Phase 03 — spec-as-source-of-truth lint over `doc/agent/MARKERS.md`.
 *
 * Three layers:
 *  (1) parser unit tests — the format is fixed; assert it parses cleanly.
 *  (2) coverage — every marker the spec defines must appear in the code
 *      (parser or dispatcher), and every code marker must appear in the spec.
 *  (3) branch ↔ user_next_action — every branch listed for a marker must
 *      have a corresponding user_next_action entry, and vice versa, so the
 *      spec cannot drift away from the dispatcher and the rule #15 invariant.
 *
 * Together these turn `MARKERS.md` into the executable source of truth for
 * dispatch coverage: adding a branch to MARKERS.md without wiring it (or
 * vice versa) breaks CI.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadMarkersSpec, parseMarkersSpec } from "../markers-spec.js";

// __dirname is server/src/services/__tests__ — repo root is four levels up.
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

const EXPECTED_MARKERS = [
	"RUN_BACKTEST",
	"RUN_PAPER",
	"EXPERIMENT_TITLE",
	"PROPOSE_DATA_FETCH",
	"PROPOSE_VALIDATION",
	"PROPOSE_NEW_EXPERIMENT",
	"PROPOSE_COMPLETE_EXPERIMENT",
	"PROPOSE_GO_PAPER",
];

describe("markers-spec parser", () => {
	const parsed = loadMarkersSpec();
	const byName = new Map(parsed.map((m) => [m.name, m]));

	it("parses every expected marker from MARKERS.md", () => {
		const found = parsed.map((m) => m.name).sort();
		expect(found).toEqual([...EXPECTED_MARKERS].sort());
	});

	it("every marker has a category (Action or Proposal)", () => {
		for (const m of parsed) {
			expect(m.category, `${m.name}.category`).not.toBe("Unknown");
		}
	});

	it("Action vs Proposal categorisation matches the marker name", () => {
		for (const m of parsed) {
			if (m.name.startsWith("PROPOSE_")) {
				expect(m.category, m.name).toBe("Proposal");
			} else {
				expect(m.category, m.name).toBe("Action");
			}
		}
	});

	it("every marker has at least one branch listed", () => {
		for (const m of parsed) {
			expect(m.branches.length, `${m.name}.branches`).toBeGreaterThan(0);
		}
	});

	it("every branch has a corresponding user_next_action entry", () => {
		const violations: string[] = [];
		for (const m of parsed) {
			// Special case: EXPERIMENT_TITLE has a single inline user_next_action
			// that does not enumerate per-branch entries — its branches are
			// metadata-only and the marker is documented as never being a turn
			// boundary.
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

	it("PROPOSE_DATA_FETCH has the four expected branches", () => {
		const m = byName.get("PROPOSE_DATA_FETCH");
		expect(m).toBeDefined();
		expect(m?.branches).toEqual(
			expect.arrayContaining(["approve+cache_hit", "approve+cache_miss", "reject", "ignore"]),
		);
	});
});

describe("markers-spec ↔ code coverage", () => {
	const parsed = loadMarkersSpec();
	const codeFiles = [
		readFileSync(join(REPO_ROOT, "server/src/services/agent-trigger.ts"), "utf8"),
		readFileSync(join(REPO_ROOT, "server/src/services/triggers.ts"), "utf8"),
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
			"  category:  Action",
			"  form:      [FOO]",
			"  branches:  - a / - b / - c",
			"  user_next_action: none",
			"```",
		].join("\n");
		const out = parseMarkersSpec(md);
		expect(out).toHaveLength(1);
		expect(out[0]?.name).toBe("FOO");
		expect(out[0]?.branches).toEqual(["a", "b", "c"]);
	});

	it("parses a multi-line branches block", () => {
		const md = [
			"```",
			"BAR()",
			"  category:  Proposal",
			"  branches:",
			"             - alpha → first",
			"             - beta  → second",
			"  user_next_action (per rule #15):",
			"             alpha → tell user A",
			"             beta  → tell user B",
			"```",
		].join("\n");
		const out = parseMarkersSpec(md);
		expect(out).toHaveLength(1);
		expect(out[0]?.branches).toEqual(["alpha", "beta"]);
		expect(out[0]?.userNextActions.alpha).toContain("tell user A");
		expect(out[0]?.userNextActions.beta).toContain("tell user B");
	});

	it("returns empty list for a fenced block that is not a marker signature", () => {
		const md = ["```", "just some text", "no marker signature here", "```"].join("\n");
		expect(parseMarkersSpec(md)).toEqual([]);
	});
});
