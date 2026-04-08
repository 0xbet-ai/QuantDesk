/**
 * Phase 09 — validateSeedPath unit tests.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateSeedPath } from "../seed-path.js";

let tmpRoot: string;

beforeAll(async () => {
	tmpRoot = await mkdtemp(join(tmpdir(), "qd-seed-test-"));
});

afterAll(async () => {
	await rm(tmpRoot, { recursive: true, force: true });
});

describe("validateSeedPath", () => {
	it("rejects an empty path", () => {
		const result = validateSeedPath("");
		expect(result.ok).toBe(false);
	});

	it("rejects a relative path", () => {
		const result = validateSeedPath("./my-strategy");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/absolute/);
	});

	it("rejects the user's home directory itself", () => {
		const result = validateSeedPath(homedir());
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/home directory itself/);
	});

	it("rejects /etc and similar absolute prefixes", () => {
		const result = validateSeedPath("/etc/passwd-dir");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/denied prefix/);
	});

	it("rejects ~/.ssh", () => {
		const result = validateSeedPath(join(homedir(), ".ssh"));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/denied home prefix/);
	});

	it("rejects a non-existent path", async () => {
		const missing = join(tmpRoot, "no-such-dir");
		const result = validateSeedPath(missing);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/does not exist/);
	});

	it("rejects a file (must be a directory)", async () => {
		const filePath = join(tmpRoot, "single.txt");
		await writeFile(filePath, "hello");
		const result = validateSeedPath(filePath);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/must be a directory/);
	});

	it("accepts a normal directory under tmp", async () => {
		const dir = join(tmpRoot, "good-dir");
		await mkdir(dir);
		await writeFile(join(dir, "strategy.py"), "print('hi')");
		const result = validateSeedPath(dir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.absolutePath).toBe(dir);
			expect(result.totalBytes).toBeGreaterThan(0);
		}
	});

	it("ignores .git / node_modules when computing total size", async () => {
		const dir = join(tmpRoot, "with-junk");
		await mkdir(join(dir, ".git"), { recursive: true });
		await mkdir(join(dir, "node_modules", "junk"), { recursive: true });
		// 1 KB of "junk" we should *not* count
		await writeFile(join(dir, ".git", "huge"), "x".repeat(1024));
		await writeFile(join(dir, "node_modules", "junk", "huge"), "x".repeat(1024));
		// 10 bytes of real strategy code we should count
		await writeFile(join(dir, "strategy.py"), "print('a')");
		const result = validateSeedPath(dir);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.totalBytes).toBe(10);
	});
});
