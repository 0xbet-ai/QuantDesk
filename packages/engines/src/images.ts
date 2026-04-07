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
export const ENGINE_IMAGES: Record<Exclude<EngineName, "generic">, string> = {
	freqtrade: "freqtradeorg/freqtrade:stable_2025.7",
	nautilus: "ghcr.io/nautechsystems/nautilus_trader:1.221.0",
} as const;

export function getEngineImage(engine: EngineName): string {
	if (engine === "generic") {
		throw new Error("generic engine does not have a Docker image");
	}
	return ENGINE_IMAGES[engine];
}
