/**
 * Phase 09 — bootstrapWorkspace integration test using real temp dirs.
 */

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapWorkspace } from "../workspace.js";

let tmpRoot: string;

beforeAll(async () => {
	tmpRoot = await mkdtemp(join(tmpdir(), "qd-bootstrap-test-"));
});

afterAll(async () => {
	await rm(tmpRoot, { recursive: true, force: true });
});

async function setupSeed(name: string): Promise<string> {
	const seed = join(tmpRoot, `seed-${name}`);
	await mkdir(seed, { recursive: true });
	await writeFile(join(seed, "strategy.py"), "print('strategy')");
	await mkdir(join(seed, "config"), { recursive: true });
	await writeFile(join(seed, "config", "params.json"), '{"timeframe":"5m"}');
	await mkdir(join(seed, ".git", "objects"), { recursive: true });
	await writeFile(join(seed, ".git", "objects", "blob"), "should be ignored");
	await mkdir(join(seed, "node_modules", "lib"), { recursive: true });
	await writeFile(join(seed, "node_modules", "lib", "junk.js"), "ignored");
	return seed;
}

describe("bootstrapWorkspace", () => {
	it("copies regular files preserving directory structure", async () => {
		const seed = await setupSeed("happy");
		const dest = join(tmpRoot, "ws-happy");
		await bootstrapWorkspace(dest, seed);

		const strategy = await readFile(join(dest, "strategy.py"), "utf8");
		expect(strategy).toBe("print('strategy')");

		const params = await readFile(join(dest, "config", "params.json"), "utf8");
		expect(params).toBe('{"timeframe":"5m"}');
	});

	it("skips .git and node_modules", async () => {
		const seed = await setupSeed("skip");
		const dest = join(tmpRoot, "ws-skip");
		await bootstrapWorkspace(dest, seed);

		const entries = await readdir(dest);
		expect(entries).not.toContain(".git");
		expect(entries).not.toContain("node_modules");
	});

	it("is idempotent — running twice produces the same files", async () => {
		const seed = await setupSeed("idem");
		const dest = join(tmpRoot, "ws-idem");
		await bootstrapWorkspace(dest, seed);
		await bootstrapWorkspace(dest, seed);
		const strategy = await readFile(join(dest, "strategy.py"), "utf8");
		expect(strategy).toBe("print('strategy')");
	});
});
