import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	commitCode,
	ensureCommit,
	getCode,
	getDiff,
	getHead,
	initWorkspace,
} from "../workspace.js";

let workspacesRoot: string;

beforeEach(async () => {
	workspacesRoot = await mkdtemp(join(tmpdir(), "quantdesk-ws-"));
});

afterEach(async () => {
	await rm(workspacesRoot, { recursive: true, force: true });
});

describe("initWorkspace", () => {
	it("engine=freqtrade → creates strategy.py + config.json", async () => {
		const dir = await initWorkspace("desk-1", "freqtrade", workspacesRoot, { venue: "binance" });
		const strategy = await readFile(join(dir, "strategy.py"), "utf-8");
		const config = await readFile(join(dir, "config.json"), "utf-8");
		expect(strategy).toContain("class");
		expect(JSON.parse(config)).toBeDefined();
	});

	it("engine=nautilus → creates strategy.py + config.py", async () => {
		const dir = await initWorkspace("desk-3", "nautilus", workspacesRoot, { venue: "binance" });
		const strategy = await readFile(join(dir, "strategy.py"), "utf-8");
		const config = await readFile(join(dir, "config.py"), "utf-8");
		expect(strategy).toBeDefined();
		expect(config).toBeDefined();
	});

	it("engine=generic → creates empty workspace with README", async () => {
		const dir = await initWorkspace("desk-4", "generic", workspacesRoot, { venue: "binance" });
		const readme = await readFile(join(dir, "README.md"), "utf-8");
		expect(readme).toContain("generic");
	});
});

describe("commitCode", () => {
	it("returns valid 40-char hash after modifying strategy file", async () => {
		const dir = await initWorkspace("desk-5", "freqtrade", workspacesRoot, { venue: "binance" });
		await writeFile(join(dir, "strategy.py"), "# modified strategy\nclass MyStrategy:\n    pass\n");
		const hash = await commitCode(dir, "update strategy");
		expect(hash).toMatch(/^[0-9a-f]{40}$/);
	});
});

describe("getCode", () => {
	it("returns exact content at commit hash", async () => {
		const dir = await initWorkspace("desk-6", "freqtrade", workspacesRoot, { venue: "binance" });

		await writeFile(join(dir, "strategy.py"), "# v2\nclass V2:\n    pass\n");
		const hash1 = await commitCode(dir, "v2");

		await writeFile(join(dir, "strategy.py"), "# v3\nclass V3:\n    pass\n");
		await commitCode(dir, "v3");

		const content = await getCode(dir, hash1, "strategy.py");
		expect(content).toBe("# v2\nclass V2:\n    pass\n");
	});
});

describe("getDiff", () => {
	it("shows only changed lines between two commits", async () => {
		const dir = await initWorkspace("desk-7", "freqtrade", workspacesRoot, { venue: "binance" });

		await writeFile(join(dir, "strategy.py"), "line1\nline2\n");
		const hash1 = await commitCode(dir, "first");

		await writeFile(join(dir, "strategy.py"), "line1\nline2\nline3\n");
		const hash2 = await commitCode(dir, "second");

		const diff = await getDiff(dir, hash1, hash2);
		expect(diff).toContain("+line3");
		expect(diff).not.toContain("-line1");
	});
});

describe("getHead", () => {
	it("returns the current HEAD hash", async () => {
		const dir = await initWorkspace("desk-head", "freqtrade", workspacesRoot, { venue: "binance" });
		const head = await getHead(dir);
		expect(head).toMatch(/^[0-9a-f]{40}$/);

		await writeFile(join(dir, "strategy.py"), "# new\n");
		const newHash = await commitCode(dir, "bump");
		expect(await getHead(dir)).toBe(newHash);
	});
});

describe("ensureCommit", () => {
	it("commits when the workspace is dirty and returns the new hash", async () => {
		const dir = await initWorkspace("desk-ensure-dirty", "freqtrade", workspacesRoot, {
			venue: "binance",
		});
		const before = await getHead(dir);

		await writeFile(join(dir, "config.json"), '{"timeframe":"1h"}');
		const hash = await ensureCommit(dir, "pre-run #1");

		expect(hash).toMatch(/^[0-9a-f]{40}$/);
		expect(hash).not.toBe(before);
		expect(await getHead(dir)).toBe(hash);
	});

	it("returns the current HEAD unchanged when the workspace is clean", async () => {
		const dir = await initWorkspace("desk-ensure-clean", "freqtrade", workspacesRoot, {
			venue: "binance",
		});
		const before = await getHead(dir);

		const hash1 = await ensureCommit(dir, "pre-run #1");
		const hash2 = await ensureCommit(dir, "pre-run #2");

		expect(hash1).toBe(before);
		expect(hash2).toBe(before);
	});

	it("respects .gitignore so engine output files are not committed", async () => {
		// Simulates a freqtrade run dropping backtest_results/*.zip into the
		// workspace between two agent edits. A subsequent ensureCommit() must
		// ignore the output artifacts and only snapshot reproducible inputs.
		const dir = await initWorkspace("desk-ignore", "freqtrade", workspacesRoot, {
			venue: "binance",
		});

		// Engine writes an output file.
		const { mkdir } = await import("node:fs/promises");
		await mkdir(join(dir, "backtest_results"), { recursive: true });
		await writeFile(join(dir, "backtest_results", "run-1.zip"), "binary-output");

		// Agent edits config.
		await writeFile(join(dir, "config.json"), '{"timeframe":"15m"}');
		const hash = await ensureCommit(dir, "pre-run #2");

		// The commit contains config.json but NOT the ignored output.
		const config = await getCode(dir, hash, "config.json");
		expect(config).toContain("15m");
		await expect(getCode(dir, hash, "backtest_results/run-1.zip")).rejects.toThrow();
	});
});

describe("workspace isolation", () => {
	it("two desks get isolated workspaces", async () => {
		const dir1 = await initWorkspace("desk-a", "freqtrade", workspacesRoot, { venue: "binance" });
		const dir2 = await initWorkspace("desk-b", "freqtrade", workspacesRoot, { venue: "binance" });

		await writeFile(join(dir1, "strategy.py"), "# desk A only\n");
		await commitCode(dir1, "desk A change");

		const dir2Content = await readFile(join(dir2, "strategy.py"), "utf-8");
		expect(dir2Content).not.toContain("desk A only");
	});
});
