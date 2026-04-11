/**
 * QuantDesk global config schema — the shape of `~/.quantdesk/config.json`
 * (overridable via `$QUANTDESK_CONFIG` env var or a repo-local
 * `.quantdesk/config.json` discovered by walking up from CWD).
 *
 * Pattern lifted from Paperclip's `packages/shared/src/config-schema.ts`
 * so the two projects stay consistent — see `doc/REFERENCES.md` for the
 * upstream link.
 *
 * The config is read once at server startup (`loadConfig()` in
 * `server/src/config-file.ts`). There is no hot-reload: changes to the
 * file require a server restart. This is intentional for boot-critical
 * values (DB connection, port, log dir) — per-desk and UI preferences
 * should live in the database, not here.
 *
 * **Precedence rules** (highest wins):
 *   1. Process environment variables (e.g. `DATABASE_URL`, `PORT`)
 *   2. Values in `config.json`
 *   3. Built-in defaults below
 *
 * Every field is optional so an empty `{}` is a valid config. Missing
 * fields fall through to defaults. A missing file itself is also fine —
 * QuantDesk boots with zero configuration on a fresh machine.
 */

import { z } from "zod";

// ── $meta ────────────────────────────────────────────────────────────
const metaSchema = z
	.object({
		version: z.number().int().positive().optional(),
		updatedAt: z.string().optional(),
		source: z.string().optional(),
	})
	.optional();

// ── database ─────────────────────────────────────────────────────────
const databaseSchema = z
	.object({
		/**
		 * `"embedded"` spawns an in-process Postgres under `~/.quantdesk/pgdata`
		 * (default — zero-setup dev). `"external"` requires `connectionString`.
		 */
		mode: z.enum(["embedded", "external"]).optional(),
		/** Only consulted when `mode === "external"`. */
		connectionString: z.string().optional(),
	})
	.optional();

// ── server ───────────────────────────────────────────────────────────
const serverSchema = z
	.object({
		port: z.number().int().positive().max(65535).optional(),
		host: z.string().optional(),
	})
	.optional();

// ── logging ──────────────────────────────────────────────────────────
const loggingSchema = z
	.object({
		level: z.enum(["trace", "debug", "info", "warn", "error"]).optional(),
		/**
		 * Directory for per-experiment agent transcripts
		 * (`<logDir>/<experimentId>.jsonl`). Defaults to
		 * `~/.quantdesk/logs`.
		 */
		logDir: z.string().optional(),
	})
	.optional();

// ── agent ────────────────────────────────────────────────────────────
const agentSchema = z
	.object({
		/** CLI model id (e.g. `claude-opus-4-6`, `gpt-5-codex`). */
		defaultModel: z.string().optional(),
		/**
		 * Max ms between stream chunks before the turn watchdog marks the
		 * turn as dead. Defaults to 90_000 (90s).
		 */
		heartbeatThresholdMs: z.number().int().positive().optional(),
		/**
		 * How often the turn watchdog wakes up to scan for stale turns.
		 * Defaults to 30_000 (30s). Faster catches stale turns sooner at
		 * the cost of a few more DB reads per minute.
		 */
		watchdogIntervalMs: z.number().int().positive().optional(),
		/**
		 * Timeout for the `claude --version` / `codex --version` adapter
		 * probe at `GET /api/agent/test`. Defaults to 5_000 (5s).
		 */
		adapterTestTimeoutMs: z.number().int().positive().optional(),
	})
	.optional();

// ── engine ───────────────────────────────────────────────────────────
const engineResourcesSchema = z
	.object({
		/** Docker `--cpus` value, e.g. `"2"` or `"0.5"`. */
		cpus: z.string().optional(),
		/** Memory in GiB. Converted to Docker `--memory` as `<n>g`. */
		memoryGb: z.number().positive().optional(),
	})
	.optional();

const engineSchema = z
	.object({
		/**
		 * Override the pinned Docker image for a specific engine. Useful
		 * for pinning to an internal mirror or a private build. Keys are
		 * engine names (`freqtrade`, `nautilus`, `generic`), values are
		 * full image refs. Unknown engines are ignored.
		 */
		imageOverrides: z.record(z.string(), z.string()).optional(),
		/**
		 * Resource limits shared across all managed engines for backtest
		 * containers. Defaults: `{ cpus: "2", memoryGb: 2 }`.
		 */
		backtest: engineResourcesSchema,
		/**
		 * Resource limits shared across all managed engines for paper
		 * containers. Defaults: `{ cpus: "1", memoryGb: 1 }`.
		 */
		paper: engineResourcesSchema,
		/**
		 * Generic-engine-specific resource override (also applies to
		 * `run_script` sandbox containers). Falls back to `backtest`
		 * when absent. Defaults: `{ cpus: "2", memoryGb: 2 }`.
		 */
		generic: engineResourcesSchema,
		/** Freqtrade-specific runtime knobs. */
		freqtrade: z
			.object({
				/**
				 * Max attempts to wait for the freqtrade REST API to come up
				 * after spawning a paper container. Defaults to 30 (≈ 30s
				 * total with the default 1 s retry delay).
				 */
				startupMaxAttempts: z.number().int().positive().optional(),
				/** Delay between startup attempts, in ms. Defaults to 1_000. */
				startupRetryDelayMs: z.number().int().positive().optional(),
				/**
				 * Timeout applied to every fetch() against the freqtrade REST
				 * API (ping, start, status, trades, profit). Defaults to 5_000.
				 */
				apiTimeoutMs: z.number().int().positive().optional(),
			})
			.optional(),
	})
	.optional();

// ── paper ────────────────────────────────────────────────────────────
const paperSchema = z
	.object({
		/**
		 * How often to poll the freqtrade REST API and emit a synthetic
		 * "market tick" into the paper log stream. Defaults to 5_000
		 * (5s). Raise on slow networks or to lower API load; lower for
		 * HFT-style monitoring.
		 */
		marketTickIntervalMs: z.number().int().positive().optional(),
		/**
		 * Grace period in seconds before forcefully killing a paper
		 * container on `stop_paper`. Defaults to 10 s.
		 */
		containerStopGracefulTimeoutSec: z.number().int().positive().optional(),
	})
	.optional();

// ── experiments ──────────────────────────────────────────────────────
const experimentsSchema = z
	.object({
		/**
		 * Maximum RM↔Analyst iteration cycles allowed AFTER the baseline
		 * run. The baseline (first successful backtest) is always free —
		 * it establishes that the strategy runs at all. Every subsequent
		 * backtest requires the previous run to have an RM verdict (the
		 * Analyst cannot iterate on its own), and the total iteration
		 * count is capped at this value. Defaults to 5, so an experiment
		 * has at most 1 baseline + 5 iterations = 6 runs before the
		 * Analyst must call `go_paper`, `new_experiment`, or
		 * `complete_experiment`.
		 *
		 * Motivation: without a cap, the Analyst tends to keep tweaking
		 * parameters until in-sample metrics look good, which is textbook
		 * overfitting. Pairing every iteration with an RM review forces
		 * each tweak through a second opinion that can reject
		 * fit-to-the-window changes.
		 */
		maxIterationsPerExperiment: z.number().int().positive().optional(),
	})
	.optional();

// ── root ─────────────────────────────────────────────────────────────
export const quantdeskConfigSchema = z
	.object({
		$meta: metaSchema,
		database: databaseSchema,
		server: serverSchema,
		logging: loggingSchema,
		agent: agentSchema,
		engine: engineSchema,
		paper: paperSchema,
		experiments: experimentsSchema,
	})
	.strict();

export type QuantDeskConfig = z.infer<typeof quantdeskConfigSchema>;
