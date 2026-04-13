import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectAnalystTrailFromEntries, collectCodeDiff } from "../risk-manager-context.js";
import { commitCode, hasChanges, initWorkspace } from "../workspace.js";

function makeRun(overrides: {
	runNumber: number;
	commitHash: string | null;
	isBaseline?: boolean;
}) {
	return {
		runNumber: overrides.runNumber,
		isBaseline: overrides.isBaseline ?? false,
		commitHash: overrides.commitHash,
		turnId: null,
		createdAt: new Date(),
	};
}

const tempRoots: string[] = [];
afterEach(() => {
	// tmpdir cleanup is best-effort — OS reaps it eventually.
	tempRoots.length = 0;
});

describe("collectCodeDiff", () => {
	it("returns null when workspacePath is missing", async () => {
		const result = await collectCodeDiff(null, makeRun({ runNumber: 1, commitHash: "abc" }), []);
		expect(result).toBeNull();
	});

	it("returns null when target run has no commit hash", async () => {
		const result = await collectCodeDiff(
			"/tmp/nonexistent",
			makeRun({ runNumber: 1, commitHash: null }),
			[],
		);
		expect(result).toBeNull();
	});

	it("produces a real diff between consecutive commits in a real workspace", async () => {
		// Seed a real workspace so `getDiff` has actual commits to read.
		const root = mkdtempSync(join(tmpdir(), "rm-ctx-"));
		tempRoots.push(root);
		const workspacePath = await initWorkspace("test-desk", "generic", root, {
			venue: "binance",
		});

		// First commit (baseline) — already created by initWorkspace.
		// Second commit — modify the seed file so there is something to diff.
		writeFileSync(join(workspacePath, "strategy.py"), "# v2\nprint('hello')\n");
		expect(await hasChanges(workspacePath)).toBe(true);
		const baselineHash = await commitCode(workspacePath, "baseline");

		writeFileSync(join(workspacePath, "strategy.py"), "# v3\nprint('hi')\n");
		const secondHash = await commitCode(workspacePath, "iter 2");

		writeFileSync(join(workspacePath, "strategy.py"), "# v4\nprint('yo')\n");
		const thirdHash = await commitCode(workspacePath, "iter 3");

		const runs = [
			makeRun({ runNumber: 1, commitHash: baselineHash, isBaseline: true }),
			makeRun({ runNumber: 2, commitHash: secondHash }),
			makeRun({ runNumber: 3, commitHash: thirdHash }),
		];
		const target = runs[2]!;

		const result = await collectCodeDiff(workspacePath, target, runs);
		expect(result).not.toBeNull();
		expect(result?.targetCommit).toBe(thirdHash);
		expect(result?.againstPrevious).toMatch(/-print\('hi'\)/);
		expect(result?.againstPrevious).toMatch(/\+print\('yo'\)/);
		expect(result?.previousLabel).toBe("Run #3 vs Run #2");
		// Baseline diff should be different from the previous diff.
		expect(result?.againstBaseline).toMatch(/-print\('hello'\)/);
		expect(result?.baselineLabel).toBe("Run #3 vs Run #1 (baseline)");
	});

	it("skips the baseline comparison when baseline is the immediately-previous run", async () => {
		const root = mkdtempSync(join(tmpdir(), "rm-ctx-"));
		tempRoots.push(root);
		const workspacePath = await initWorkspace("test-desk-2", "generic", root, {
			venue: "binance",
		});

		writeFileSync(join(workspacePath, "strategy.py"), "# baseline\n");
		const baselineHash = await commitCode(workspacePath, "baseline");

		writeFileSync(join(workspacePath, "strategy.py"), "# first iter\n");
		const secondHash = await commitCode(workspacePath, "iter 2");

		const runs = [
			makeRun({ runNumber: 1, commitHash: baselineHash, isBaseline: true }),
			makeRun({ runNumber: 2, commitHash: secondHash }),
		];
		const target = runs[1]!;

		const result = await collectCodeDiff(workspacePath, target, runs);
		expect(result).not.toBeNull();
		expect(result?.againstPrevious).toMatch(/-# baseline/);
		// baseline == previous, so we don't duplicate the diff.
		expect(result?.againstBaseline).toBeNull();
		expect(result?.baselineLabel).toBeNull();
	});
});

describe("collectAnalystTrailFromEntries", () => {
	it("returns an empty array when no entries are given", () => {
		expect(collectAnalystTrailFromEntries([])).toEqual([]);
	});

	it("picks up thinking / tool_call / text chunks and drops unrelated types", () => {
		const entries = [
			{ ts: "t0", type: "init", sessionId: "s1" },
			{ ts: "t1", type: "thinking", content: "planning to add RSI filter" },
			{
				ts: "t2",
				type: "tool_call",
				name: "mcp__quantdesk__run_backtest",
				input: { entrypoint: "strategy.py" },
			},
			{ ts: "t3", type: "text", content: "Run #3 baseline failed" },
			{ ts: "t4", type: "result", content: "ignored" },
		];
		const trail = collectAnalystTrailFromEntries(entries);
		expect(trail).toHaveLength(3);
		expect(trail[0]).toMatchObject({ type: "thinking", content: "planning to add RSI filter" });
		expect(trail[1]).toMatchObject({
			type: "tool_call",
			name: "mcp__quantdesk__run_backtest",
		});
		expect(trail[1]?.content).toContain("strategy.py");
		expect(trail[2]).toMatchObject({ type: "text", content: "Run #3 baseline failed" });
	});

	it("drops empty / whitespace-only thinking chunks", () => {
		const trail = collectAnalystTrailFromEntries([
			{ ts: "t0", type: "thinking", content: "   " },
			{ ts: "t1", type: "text", content: "done" },
		]);
		expect(trail).toHaveLength(1);
		expect(trail[0]?.type).toBe("text");
	});

	it("truncates very long chunks to keep the prompt budget", () => {
		const huge = "x".repeat(5000);
		const trail = collectAnalystTrailFromEntries([{ ts: "t0", type: "thinking", content: huge }]);
		expect(trail).toHaveLength(1);
		expect(trail[0]?.content.length).toBeLessThan(huge.length);
		expect(trail[0]?.content).toMatch(/truncated/);
	});
});
