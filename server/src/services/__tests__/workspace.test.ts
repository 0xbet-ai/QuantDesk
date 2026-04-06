import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commitCode, getCode, getDiff, initWorkspace } from "../workspace.js";

let workspacesRoot: string;

beforeEach(async () => {
	workspacesRoot = await mkdtemp(join(tmpdir(), "quantdesk-ws-"));
});

afterEach(async () => {
	await rm(workspacesRoot, { recursive: true, force: true });
});

describe("initWorkspace", () => {
	it("engine=freqtrade → creates strategy.py + config.json", async () => {
		const dir = await initWorkspace("desk-1", "freqtrade", workspacesRoot);
		const strategy = await readFile(join(dir, "strategy.py"), "utf-8");
		const config = await readFile(join(dir, "config.json"), "utf-8");
		expect(strategy).toContain("class");
		expect(JSON.parse(config)).toBeDefined();
	});

	it("engine=hummingbot → creates strategy.py + conf_*.yml", async () => {
		const dir = await initWorkspace("desk-2", "hummingbot", workspacesRoot);
		const strategy = await readFile(join(dir, "strategy.py"), "utf-8");
		expect(strategy).toBeDefined();
		const { readdirSync } = await import("node:fs");
		const files = readdirSync(dir);
		expect(files.some((f: string) => f.startsWith("conf_") && f.endsWith(".yml"))).toBe(true);
	});

	it("engine=nautilus → creates strategy.py + config.py", async () => {
		const dir = await initWorkspace("desk-3", "nautilus", workspacesRoot);
		const strategy = await readFile(join(dir, "strategy.py"), "utf-8");
		const config = await readFile(join(dir, "config.py"), "utf-8");
		expect(strategy).toBeDefined();
		expect(config).toBeDefined();
	});

	it("engine=generic → creates empty workspace with README", async () => {
		const dir = await initWorkspace("desk-4", "generic", workspacesRoot);
		const readme = await readFile(join(dir, "README.md"), "utf-8");
		expect(readme).toContain("generic");
	});
});

describe("commitCode", () => {
	it("returns valid 40-char hash after modifying strategy file", async () => {
		const dir = await initWorkspace("desk-5", "freqtrade", workspacesRoot);
		await writeFile(join(dir, "strategy.py"), "# modified strategy\nclass MyStrategy:\n    pass\n");
		const hash = await commitCode(dir, "update strategy");
		expect(hash).toMatch(/^[0-9a-f]{40}$/);
	});
});

describe("getCode", () => {
	it("returns exact content at commit hash", async () => {
		const dir = await initWorkspace("desk-6", "freqtrade", workspacesRoot);

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
		const dir = await initWorkspace("desk-7", "freqtrade", workspacesRoot);

		await writeFile(join(dir, "strategy.py"), "line1\nline2\n");
		const hash1 = await commitCode(dir, "first");

		await writeFile(join(dir, "strategy.py"), "line1\nline2\nline3\n");
		const hash2 = await commitCode(dir, "second");

		const diff = await getDiff(dir, hash1, hash2);
		expect(diff).toContain("+line3");
		expect(diff).not.toContain("-line1");
	});
});

describe("workspace isolation", () => {
	it("two desks get isolated workspaces", async () => {
		const dir1 = await initWorkspace("desk-a", "freqtrade", workspacesRoot);
		const dir2 = await initWorkspace("desk-b", "freqtrade", workspacesRoot);

		await writeFile(join(dir1, "strategy.py"), "# desk A only\n");
		await commitCode(dir1, "desk A change");

		const dir2Content = await readFile(join(dir2, "strategy.py"), "utf-8");
		expect(dir2Content).not.toContain("desk A only");
	});
});
