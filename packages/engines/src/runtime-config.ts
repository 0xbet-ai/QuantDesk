/**
 * Engine-package runtime config bridge.
 *
 * The `@quantdesk/engines` package cannot import from the server
 * (circular dependency) but the adapters need a few values the
 * operator sets through `server/src/config-file.ts` — Docker resource
 * limits, image overrides, freqtrade retry knobs.
 *
 * The server calls `setEngineRuntimeConfig()` at boot with the fields
 * from its resolved config. Adapters then call `getEngineRuntimeConfig()`
 * whenever they need a value. Defaults match the historical hardcoded
 * values, so an adapter used without the server (e.g. from a test)
 * still behaves identically.
 *
 * This is a deliberate mutable module-level singleton — NOT recommended
 * for business logic, but it's the simplest way to inject boot-time
 * tuning without plumbing config through every adapter method signature.
 * Treat the setter as idempotent: call it once, early, and never again.
 */

export interface EngineResources {
	/** Docker `--cpus` value, e.g. `"2"` or `"0.5"`. */
	cpus: string;
	/** Memory limit expressed in GiB; adapters format it as `"<n>g"`. */
	memoryGb: number;
}

export interface EngineRuntimeConfig {
	/**
	 * Map of engine name → fully-qualified Docker image ref. Keys that
	 * don't match `ENGINE_IMAGES` are ignored. Missing keys fall through
	 * to the pinned default in `images.ts`.
	 */
	imageOverrides: Record<string, string>;
	backtest: EngineResources;
	paper: EngineResources;
	generic: EngineResources;
	freqtrade: {
		startupMaxAttempts: number;
		startupRetryDelayMs: number;
		apiTimeoutMs: number;
	};
	/**
	 * Grace period (seconds) before forcefully killing a paper container
	 * on `stop_paper`. Shared across all adapters' `stopPaper()` calls so
	 * operators can tune shutdown speed vs. cleanup safety in one place.
	 */
	paperStopGracefulSec: number;
}

const DEFAULTS: EngineRuntimeConfig = {
	imageOverrides: {},
	backtest: { cpus: "2", memoryGb: 2 },
	paper: { cpus: "1", memoryGb: 1 },
	generic: { cpus: "2", memoryGb: 2 },
	freqtrade: {
		startupMaxAttempts: 30,
		startupRetryDelayMs: 1_000,
		apiTimeoutMs: 5_000,
	},
	paperStopGracefulSec: 10,
};

let current: EngineRuntimeConfig = DEFAULTS;

export function setEngineRuntimeConfig(cfg: EngineRuntimeConfig): void {
	current = cfg;
}

export function getEngineRuntimeConfig(): EngineRuntimeConfig {
	return current;
}

/** Format a `memoryGb` number as the `"<n>g"` Docker memory string. */
export function formatMemory(memoryGb: number): string {
	// Docker accepts decimal GiB (e.g. "1.5g"), so preserve fractions
	// but trim trailing zeros for readability.
	const trimmed = memoryGb.toString();
	return `${trimmed}g`;
}

/**
 * Return the effective image ref for an engine, honouring any config
 * override. Callers pass the pinned default from `ENGINE_IMAGES`; if an
 * override is present for this engine name, the override wins.
 */
export function resolveImage(engineName: string, pinnedDefault: string): string {
	return current.imageOverrides[engineName] ?? pinnedDefault;
}

/** Test-only reset to defaults. Production code must not call this. */
export function resetEngineRuntimeConfigForTests(): void {
	current = DEFAULTS;
}
