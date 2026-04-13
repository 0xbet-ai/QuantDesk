/**
 * Global config file loader — reads `~/.quantdesk/config.json` (or the
 * override path), validates it with the shared Zod schema, and merges
 * environment variables + built-in defaults on top.
 *
 * Called exactly once at server boot from `index.ts`. The returned
 * `ResolvedConfig` is then passed wherever the server previously read
 * `process.env.*` directly. Missing config file is fine — the function
 * returns a fully-defaulted object so a fresh machine boots with zero
 * configuration.
 *
 * Path resolution (first match wins):
 *   1. `$QUANTDESK_CONFIG` env var (explicit override)
 *   2. `.quantdesk/config.json` discovered by walking up from `process.cwd()`
 *   3. `~/.quantdesk/config.json` (default home location)
 *
 * Precedence when merging values:
 *   env vars  >  config file  >  defaults
 *
 * See `packages/shared/src/config-schema.ts` for the field list and
 * documentation of each section.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { DeploymentMode, QuantDeskConfig } from "@quantdesk/shared";
import { quantdeskConfigSchema } from "@quantdesk/shared";

// ── Defaults ─────────────────────────────────────────────────────────
// Kept in one place so the loader is the single source of truth for
// "what happens when the field is absent everywhere". Anything that
// previously lived in an inline `?? 3000` style fallback should move
// here so the whole server agrees on one default.

type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_LOG_LEVEL: LogLevel = "info";

// Agent
const DEFAULT_AGENT_MODEL = "claude-opus-4-6";
// 5 minutes. The previous 90s default caused false-positive "heartbeat
// timeout" messages during two legitimate silent periods:
//   1. Docker container execution (fixed by PYTHONUNBUFFERED=1 +
//      heartbeat proxy in onLogLine — see f9c34da / e07fe5f)
//   2. Claude's extended thinking (2-3 min of internal reasoning before
//      emitting any stream chunk — CLI doesn't stream thinking blocks
//      in real time, so the heartbeat goes stale). We can't inject
//      heartbeat during thinking — it's internal to the CLI subprocess.
//      5 minutes gives enough headroom for deep thinking while still
//      catching genuinely dead agents within a reasonable window.
const DEFAULT_HEARTBEAT_MS = 300_000;
const DEFAULT_WATCHDOG_INTERVAL_MS = 30_000;
const DEFAULT_ADAPTER_TEST_TIMEOUT_MS = 5_000;

// Database
const DEFAULT_DATABASE_URL = "postgresql://quantdesk:quantdesk@localhost:5432/quantdesk";

// Engine — shared resource defaults matching the previous hardcoded
// Docker limits in `packages/engines/src/**/adapter.ts`.
const DEFAULT_BACKTEST_CPUS = "2";
const DEFAULT_BACKTEST_MEMORY_GB = 2;
const DEFAULT_PAPER_CPUS = "1";
const DEFAULT_PAPER_MEMORY_GB = 1;
const DEFAULT_GENERIC_CPUS = "2";
const DEFAULT_GENERIC_MEMORY_GB = 2;

// Engine — freqtrade-specific
const DEFAULT_FREQTRADE_STARTUP_MAX_ATTEMPTS = 30;
const DEFAULT_FREQTRADE_STARTUP_RETRY_DELAY_MS = 1_000;
const DEFAULT_FREQTRADE_API_TIMEOUT_MS = 5_000;

// Paper
const DEFAULT_PAPER_MARKET_TICK_INTERVAL_MS = 5_000;
const DEFAULT_PAPER_CONTAINER_STOP_GRACEFUL_SEC = 10;

// Experiments
// Baseline run (first successful backtest per experiment) is always
// free — this cap applies to the RM↔Analyst iteration cycles AFTER
// the baseline. With the default of 5, an experiment tops out at
// 1 baseline + 5 iterations = 6 runs before the Analyst is forced
// to commit (go_paper / new_experiment / complete_experiment).
const DEFAULT_MAX_ITERATIONS_PER_EXPERIMENT = 5;

// Auth
const DEFAULT_DEPLOYMENT_MODE: DeploymentMode = "local_trusted";

// ── Resolved shape (no `undefined` anywhere) ─────────────────────────

export interface EngineResources {
	cpus: string;
	memoryGb: number;
}

export interface ResolvedConfig {
	source: "default" | "file" | "env-override";
	configPath: string | null;
	database: {
		mode: "embedded" | "external";
		connectionString: string | null;
	};
	server: {
		port: number;
		host: string;
	};
	logging: {
		level: LogLevel;
		logDir: string;
	};
	agent: {
		defaultModel: string;
		heartbeatThresholdMs: number;
		watchdogIntervalMs: number;
		adapterTestTimeoutMs: number;
	};
	engine: {
		imageOverrides: Record<string, string>;
		backtest: EngineResources;
		paper: EngineResources;
		generic: EngineResources;
		freqtrade: {
			startupMaxAttempts: number;
			startupRetryDelayMs: number;
			apiTimeoutMs: number;
		};
	};
	paper: {
		marketTickIntervalMs: number;
		containerStopGracefulTimeoutSec: number;
	};
	experiments: {
		maxIterationsPerExperiment: number;
	};
	auth: {
		deploymentMode: DeploymentMode;
		disableSignUp: boolean;
		allowedHostnames: string[];
	};
}

// ── Path resolution ──────────────────────────────────────────────────

/**
 * Walk up from `start` looking for a `.quantdesk/config.json`. Stops at
 * the filesystem root. Returns `null` if nothing is found. Matches
 * Paperclip's `.paperclip/config.json` discovery so monorepos can carry
 * a per-checkout config file.
 */
function walkUpForConfig(start: string): string | null {
	let dir = resolve(start);
	// Cap at 30 ancestors so a broken symlink loop can't hang the server.
	for (let i = 0; i < 30; i++) {
		const candidate = join(dir, ".quantdesk", "config.json");
		if (existsSync(candidate)) return candidate;
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
	return null;
}

export function resolveConfigPath(): string | null {
	const override = process.env.QUANTDESK_CONFIG;
	if (override) {
		const abs = isAbsolute(override) ? override : resolve(process.cwd(), override);
		return existsSync(abs) ? abs : null;
	}
	const walked = walkUpForConfig(process.cwd());
	if (walked) return walked;
	const home = join(homedir(), ".quantdesk", "config.json");
	return existsSync(home) ? home : null;
}

// ── Read + validate ──────────────────────────────────────────────────

/**
 * Load the raw config file without merging defaults or env vars. Returns
 * `null` when no file exists (a fresh install). Throws with a clear
 * message when the file exists but is malformed — callers should not
 * silently swallow a broken config.
 */
export function readConfigFile(): QuantDeskConfig | null {
	const path = resolveConfigPath();
	if (!path) return null;
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path, "utf-8"));
	} catch (err) {
		throw new Error(
			`QuantDesk config at ${path} is not valid JSON: ${
				err instanceof Error ? err.message : String(err)
			}`,
		);
	}
	const parsed = quantdeskConfigSchema.safeParse(raw);
	if (!parsed.success) {
		throw new Error(
			`QuantDesk config at ${path} failed validation: ${parsed.error.message}`,
		);
	}
	return parsed.data;
}

// ── Merge ────────────────────────────────────────────────────────────

function pickResources(
	fileResources: { cpus?: string; memoryGb?: number } | undefined,
	fallbackCpus: string,
	fallbackMemoryGb: number,
	inherit?: EngineResources,
): EngineResources {
	return {
		cpus: fileResources?.cpus ?? inherit?.cpus ?? fallbackCpus,
		memoryGb: fileResources?.memoryGb ?? inherit?.memoryGb ?? fallbackMemoryGb,
	};
}

/**
 * Compose defaults → file → env vars into a fully-resolved config.
 * Every field is guaranteed non-undefined on return so downstream code
 * can skip the `?? fallback` dance completely.
 */
export function loadConfig(): ResolvedConfig {
	const file = readConfigFile();

	// ── database ─────────────────────────────────────────────────────
	const envDatabaseUrl = process.env.DATABASE_URL;
	const databaseMode: "embedded" | "external" = envDatabaseUrl
		? "external"
		: (file?.database?.mode ?? "embedded");
	const databaseConnectionString =
		envDatabaseUrl ??
		file?.database?.connectionString ??
		(databaseMode === "external" ? DEFAULT_DATABASE_URL : null);

	// ── server ───────────────────────────────────────────────────────
	const envPort = process.env.PORT ? Number(process.env.PORT) : undefined;
	const port =
		envPort && Number.isFinite(envPort) && envPort > 0
			? envPort
			: (file?.server?.port ?? DEFAULT_PORT);
	const host = process.env.HOST ?? file?.server?.host ?? DEFAULT_HOST;

	// ── logging ──────────────────────────────────────────────────────
	const envLogLevel = process.env.LOG_LEVEL as LogLevel | undefined;
	const level = envLogLevel ?? file?.logging?.level ?? DEFAULT_LOG_LEVEL;
	const logDir =
		process.env.QUANTDESK_LOG_DIR ??
		file?.logging?.logDir ??
		join(homedir(), ".quantdesk", "logs");

	// ── agent ────────────────────────────────────────────────────────
	const defaultModel =
		process.env.AGENT_MODEL ?? file?.agent?.defaultModel ?? DEFAULT_AGENT_MODEL;
	const heartbeatThresholdMs =
		file?.agent?.heartbeatThresholdMs ?? DEFAULT_HEARTBEAT_MS;
	const watchdogIntervalMs =
		file?.agent?.watchdogIntervalMs ?? DEFAULT_WATCHDOG_INTERVAL_MS;
	const adapterTestTimeoutMs =
		file?.agent?.adapterTestTimeoutMs ?? DEFAULT_ADAPTER_TEST_TIMEOUT_MS;

	// ── engine ───────────────────────────────────────────────────────
	const imageOverrides = file?.engine?.imageOverrides ?? {};
	const backtest = pickResources(
		file?.engine?.backtest,
		DEFAULT_BACKTEST_CPUS,
		DEFAULT_BACKTEST_MEMORY_GB,
	);
	const paperRes = pickResources(
		file?.engine?.paper,
		DEFAULT_PAPER_CPUS,
		DEFAULT_PAPER_MEMORY_GB,
	);
	// Generic falls back to backtest if unspecified — they share the
	// same default shape (2 CPU / 2 GB) and operators usually want a
	// single knob unless they hit a specific generic workload.
	const generic = pickResources(
		file?.engine?.generic,
		DEFAULT_GENERIC_CPUS,
		DEFAULT_GENERIC_MEMORY_GB,
		backtest,
	);
	const freqtrade = {
		startupMaxAttempts:
			file?.engine?.freqtrade?.startupMaxAttempts ?? DEFAULT_FREQTRADE_STARTUP_MAX_ATTEMPTS,
		startupRetryDelayMs:
			file?.engine?.freqtrade?.startupRetryDelayMs ?? DEFAULT_FREQTRADE_STARTUP_RETRY_DELAY_MS,
		apiTimeoutMs: file?.engine?.freqtrade?.apiTimeoutMs ?? DEFAULT_FREQTRADE_API_TIMEOUT_MS,
	};

	// ── paper ────────────────────────────────────────────────────────
	const paperSection = {
		marketTickIntervalMs:
			file?.paper?.marketTickIntervalMs ?? DEFAULT_PAPER_MARKET_TICK_INTERVAL_MS,
		containerStopGracefulTimeoutSec:
			file?.paper?.containerStopGracefulTimeoutSec ?? DEFAULT_PAPER_CONTAINER_STOP_GRACEFUL_SEC,
	};

	// ── experiments ──────────────────────────────────────────────────
	const experimentsSection = {
		maxIterationsPerExperiment:
			file?.experiments?.maxIterationsPerExperiment ?? DEFAULT_MAX_ITERATIONS_PER_EXPERIMENT,
	};

	const configPath = resolveConfigPath();
	const source: ResolvedConfig["source"] = configPath
		? "file"
		: envDatabaseUrl || envPort || envLogLevel || process.env.AGENT_MODEL
			? "env-override"
			: "default";

	return {
		source,
		configPath,
		database: { mode: databaseMode, connectionString: databaseConnectionString },
		server: { port, host },
		logging: { level, logDir },
		agent: {
			defaultModel,
			heartbeatThresholdMs,
			watchdogIntervalMs,
			adapterTestTimeoutMs,
		},
		engine: {
			imageOverrides,
			backtest,
			paper: paperRes,
			generic,
			freqtrade,
		},
		paper: paperSection,
		experiments: experimentsSection,
		auth: {
			deploymentMode:
				(process.env.QUANTDESK_DEPLOYMENT_MODE as DeploymentMode) ??
				file?.auth?.deploymentMode ??
				DEFAULT_DEPLOYMENT_MODE,
			disableSignUp: file?.auth?.disableSignUp ?? false,
			allowedHostnames: file?.auth?.allowedHostnames ?? [],
		},
	};
}

// ── Singleton ────────────────────────────────────────────────────────

let cachedConfig: ResolvedConfig | null = null;

/**
 * Returns the resolved config, loading it on first call. Downstream
 * modules should call this instead of reading `process.env.*` directly
 * so future config-file additions propagate without hunting every
 * env-var site.
 */
export function getConfig(): ResolvedConfig {
	if (!cachedConfig) cachedConfig = loadConfig();
	return cachedConfig;
}

/**
 * Reset the cache. Used only by tests — production code should treat
 * config as immutable for the life of the process.
 */
export function resetConfigForTests(): void {
	cachedConfig = null;
}
