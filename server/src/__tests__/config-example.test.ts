/**
 * Drift guard: `config.example.json` must parse cleanly against the
 * shared Zod config schema. Without this test we can (and did) add a
 * new field to the schema + loader and forget to document it in the
 * example file.
 *
 * The example file is the user-facing contract: every field the
 * server reads from `~/.quantdesk/config.json` should appear here at
 * least once so operators can discover it. A missing field is the
 * kind of silent drift this test exists to catch on PR.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { quantdeskConfigSchema } from "@quantdesk/shared";
import { describe, expect, it } from "vitest";

const EXAMPLE_PATH = resolve(__dirname, "..", "..", "..", "config.example.json");

describe("config.example.json", () => {
	const raw = readFileSync(EXAMPLE_PATH, "utf-8");
	const parsed = JSON.parse(raw);

	it("parses cleanly against the shared zod schema", () => {
		const result = quantdeskConfigSchema.safeParse(parsed);
		if (!result.success) {
			// Surface the Zod issue list verbatim so a broken example is
			// trivial to fix from the test output alone.
			console.error("config.example.json failed schema validation:");
			for (const issue of result.error.issues) {
				console.error(`  • ${issue.path.join(".") || "<root>"}: ${issue.message}`);
			}
		}
		expect(result.success).toBe(true);
	});

	it("documents every top-level section the schema knows about", () => {
		// `$meta` is the only root key the runtime strips before passing
		// to the loader; everything else should be discoverable in the
		// example so operators have a single place to look.
		const expected = [
			"database",
			"server",
			"logging",
			"agent",
			"engine",
			"paper",
			"experiments",
			"auth",
		];
		const present = Object.keys(parsed).filter((k) => !k.startsWith("$"));
		for (const section of expected) {
			expect(present, `example must include top-level "${section}" section`).toContain(section);
		}
	});

	it("documents every knob under `experiments`", () => {
		// Explicit allowlist so adding a field to the schema without
		// updating the example trips this assertion. Extend this list
		// whenever the experiments section grows.
		const expected = ["maxIterationsPerExperiment"];
		for (const key of expected) {
			expect(parsed.experiments ?? {}, `example.experiments must document "${key}"`).toHaveProperty(
				key,
			);
		}
	});
});
