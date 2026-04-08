/**
 * Phase 10 — validateExternalMount(s) unit tests.
 */

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateExternalMount, validateExternalMounts } from "../seed-path.js";

let tmpRoot: string;
let goodDir: string;

beforeAll(async () => {
	tmpRoot = await mkdtemp(join(tmpdir(), "qd-mounts-test-"));
	goodDir = join(tmpRoot, "btc_clober");
	await mkdir(goodDir, { recursive: true });
});

afterAll(async () => {
	await rm(tmpRoot, { recursive: true, force: true });
});

describe("validateExternalMount", () => {
	it("rejects an empty label", () => {
		const result = validateExternalMount({ label: "", hostPath: goodDir });
		expect(result.ok).toBe(false);
	});

	it("rejects a label with uppercase or special chars", () => {
		expect(validateExternalMount({ label: "BAD", hostPath: goodDir }).ok).toBe(false);
		expect(validateExternalMount({ label: "with space", hostPath: goodDir }).ok).toBe(false);
		expect(validateExternalMount({ label: "with/slash", hostPath: goodDir }).ok).toBe(false);
	});

	it("accepts a valid label + path", () => {
		const result = validateExternalMount({ label: "btc_1m", hostPath: goodDir });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.mount.label).toBe("btc_1m");
			expect(result.mount.hostPath).toBe(goodDir);
		}
	});

	it("propagates host-path validation errors with a label-prefixed reason", () => {
		const result = validateExternalMount({ label: "good", hostPath: "/etc" });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/external mount "good"/);
	});
});

describe("validateExternalMounts", () => {
	it("accepts an empty list", () => {
		const result = validateExternalMounts([]);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.mounts).toEqual([]);
	});

	it("accepts multiple distinct labels", () => {
		const result = validateExternalMounts([
			{ label: "btc_1m", hostPath: goodDir },
			{ label: "eth_5m", hostPath: goodDir },
		]);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.mounts).toHaveLength(2);
	});

	it("rejects duplicate labels", () => {
		const result = validateExternalMounts([
			{ label: "btc", hostPath: goodDir },
			{ label: "btc", hostPath: goodDir },
		]);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/used twice/);
	});

	it("rejects the whole list when one mount is bad", () => {
		const result = validateExternalMounts([
			{ label: "good", hostPath: goodDir },
			{ label: "bad", hostPath: "/etc/passwd" },
		]);
		expect(result.ok).toBe(false);
	});
});
