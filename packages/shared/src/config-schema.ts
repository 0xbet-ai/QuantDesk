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
		 * turn as dead. Defaults to 90_000 (90s) in the watchdog.
		 */
		heartbeatThresholdMs: z.number().int().positive().optional(),
	})
	.optional();

// ── engine ───────────────────────────────────────────────────────────
const engineSchema = z
	.object({
		/**
		 * Override the pinned Docker image for a specific engine. Useful
		 * for pinning to an internal mirror or a private build. Keys are
		 * engine names (`freqtrade`, `nautilus`, `generic`), values are
		 * full image refs. Unknown engines are ignored.
		 */
		imageOverrides: z.record(z.string(), z.string()).optional(),
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
	})
	.strict();

export type QuantDeskConfig = z.infer<typeof quantdeskConfigSchema>;
