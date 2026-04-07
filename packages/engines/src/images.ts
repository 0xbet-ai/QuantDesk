import type { EngineName } from "@quantdesk/shared";

/**
 * Pinned Docker image tags for every managed engine.
 *
 * Bumping a tag is a deliberate change that must be accompanied by:
 *   - Parser fixture updates (JSON / stdout JSONL shapes sometimes shift)
 *   - Integration test re-run against the new image
 *   - A changelog entry
 *
 * NEVER use `:latest` or floating tags — that would break reproducibility
 * between backtest and paper runs (CLAUDE.md rule 11).
 *
 * The `generic` engine has no managed image because it runs agent-written
 * scripts directly on the host (generic is the opt-out from isolation).
 */
// Freqtrade ships proper version-pinned Docker tags (`2026.3`, `2026.2`, ...).
// Nautilus's ghcr.io image only publishes `latest` / `nightly`, so we pin it
// to the immutable sha256 digest of the release we validated against.
export const ENGINE_IMAGES: Record<Exclude<EngineName, "generic">, string> = {
	freqtrade: "freqtradeorg/freqtrade:2026.3",
	nautilus:
		"ghcr.io/nautechsystems/nautilus_trader@sha256:52ef66dba3183f3815873add2c967ba99485ce1b9503c415e40ecd18564a5fa1",
} as const;

export function getEngineImage(engine: EngineName): string {
	if (engine === "generic") {
		throw new Error("generic engine does not have a Docker image");
	}
	return ENGINE_IMAGES[engine];
}
