# CLAUDE.md

## Purpose

QuantDesk is an AI-agent workspace for quantitative trading.
Users research, backtest, and validate strategies through async interaction with AI agents (Analyst, Risk Manager).

- **Strategy Desk**: Workspace with budget (USD), target return, and stop-loss constraints. Pick from a curated catalog or generate a custom strategy from natural language.
- **Experiments & Runs**: Organize work into experiments (research threads) within a desk. Each experiment tracks multiple backtest runs with normalized results for comparison.
- **Dataset Management**: Reusable market data scoped per desk — exchange, pairs, timeframe, and date range. Shared across runs.
- **Code Versioning**: Per-desk git workspace. Agent commits strategy code on every change; each run links to its exact commit hash.
- **Paper Trading**: User approves a validated strategy to start paper trading. Engine runs the strategy in paper mode.
- **Engine Adapters**: Pluggable engines for backtesting and paper trading. See `doc/engine/README.md`.
- **Agent Layer**: AI CLI subprocess with session persistence and hipocampus-inspired memory compaction.

## Read This First

- `doc/OVERVIEW.md` — tech stack, repo map
- `doc/agent/TURN.md` — how a single agent turn is executed (CLI subprocess, prompt, session)
- `doc/agent/PAPER_LIFECYCLE.md` — long-running paper trading state machine, observer turns, reconcile
- `doc/agent/MCP.md` — MCP tool glossary (the agent↔server protocol)
- `doc/agent/ROLES.md` — Analyst, Risk Manager, interaction pattern
- `doc/agent/MEMORY.md` — hipocampus-inspired long-term context
- `doc/engine/README.md` — pluggable engine adapter interface (incl. per-engine workspace layout)
- `doc/desk/STORAGE.md` — where a desk's state lives on disk and in the database
- `doc/plans/` — gaps between current code and spec (the only directory where hedging language is allowed)
- `doc/REFERENCES.md` — upstream references (Paperclip, Hipocampus, engine projects, etc.)

## Dev Setup

Prerequisites: Node.js 20+, pnpm 9.15+, Docker (for engine executors only), Claude CLI (`claude`) or Codex CLI (`codex`).

```bash
pnpm install
pnpm dev
```

PostgreSQL runs in-process via `embedded-postgres` (data under `~/.quantdesk/pgdata`) — no Docker required for the database. Docker is reserved for engine executor containers spawned at runtime.

To point at an external Postgres instead, set `DATABASE_URL` before running any script (`dev`, `db:migrate`, `db:seed`, `db:reset`).

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start server + UI in dev mode |
| `pnpm build` | Build all packages |
| `pnpm typecheck` | TypeScript type checking |
| `pnpm check` | Biome linter + formatter |
| `pnpm test` | Vitest test suite |
| `pnpm db:migrate` | Run Drizzle migrations |
| `pnpm db:generate` | Generate migration from schema changes |

## Environment Variables

| Variable | Default |
|----------|---------|
| `DATABASE_URL` | `postgresql://quantdesk:quantdesk@localhost:5432/quantdesk` |
| `PORT` | `3000` |
| `AGENT_MODEL` | `claude-opus-4-6` |
| `LOG_LEVEL` | `info` |

## Debugging

Agent session transcripts (tool_call / tool_result / text / thinking chunks)
are persisted per-experiment at `~/.quantdesk/logs/<experimentId>.jsonl`.
Tail the most recent one in real time:

```bash
tail -f "$(ls -t ~/.quantdesk/logs/*.jsonl | head -1)" | jq .
```

This is the fastest way to verify MCP tool calls are actually firing
(`type: "tool_call"` with `name: "mcp__quantdesk__..."`) and to read the
returned tool_result payload.

## Rules

1. **English only** — all code, comments, strings, docs, commits.
2. **File refs** — repo-root relative (`src/core/runner.ts:42`), never absolute.
3. **Commits** — `<type>: <description>`. Types: `feat`, `fix`, `refactor`, `docs`, `chore`.
4. **Secrets** — never commit. Use env vars. `.env` is gitignored.
5. **Scope** — backtesting and paper trading only. **Live trading is an explicit forever non-goal** — never implement, design for, or expose real-money trading in APIs or UI. No API keys for trading, no custody, no order routing to real venues.
6. **Engine selection is automatic, but the resolved engine is visible.** Users pick a **strategy mode** (`classic` or `realtime`) and a venue at desk creation; the system auto-resolves the engine (Freqtrade / Nautilus / Generic) from that pair and pins it for the desk's lifetime. The resolved engine is shown on the Desk Settings page so operators can read the Run transcripts, match behaviour to `doc/engine/README.md`, and debug cross-engine issues (e.g. "this container error is a Nautilus pyo3 binding, not Freqtrade"). Users must NOT be asked to pick an engine directly — the pick is always through `(mode, venue)`. The full mapping and the closed whitelist live in `doc/engine/README.md`.
7. **Managed engine whitelist is closed.** Current set: Freqtrade, Nautilus, Generic (see `doc/engine/README.md`). Adding a new managed adapter requires explicit user approval and following `doc/engine/ADD.md`. Default answer to "should we add engine X?" is **no** — try the generic engine first.
8. **One mode per desk, immutable.** Each desk pins `strategy_mode` (and therefore its engine) at creation time; both are immutable for the desk's lifetime, enforced in `services/desks.ts`. Guarantees backtest↔paper fidelity.
9. **Engines run in Docker with pinned images.** Never install engines natively on the host; never use `:latest`. Only the engine layer is containerized — server, UI, and agent CLI run on the host. Per-engine specifics: `doc/engine/README.md`.
10. **Paper sessions must survive server restart.** Paper containers are tagged so they can be reconciled after a restart instead of being marked failed. Label set and reconcile mechanism: `doc/engine/README.md` and `doc/agent/PAPER_LIFECYCLE.md`.
11. **Docs are the spec, code follows.** `doc/` describes the system in present tense as if fully implemented. Hedging language (`TODO`, `planned`, `not yet implemented`, etc.) is only allowed under `doc/plans/`, which tracks gaps between spec and code. If code contradicts a doc, fix the code unless the user approves a spec change. **Phase lifecycle:** finished phase files (tests pass, code merged) are deleted from `doc/plans/` and replaced with a one-line entry under the DONE section of `doc/plans/README.md`.
12. **No user dead-ends.** Every lifecycle branch surfaces a clear next action (concrete agent question, action-phrase system comment, or queued retrigger). Spec + enforcement (`no-dead-end-lint`, `has-next-action`, dead-end guard): `doc/agent/TURN.md`.
13. **Approval is conversational.** User consent lives in chat — no structured proposals, no approve/reject buttons, no server-side approval UI. Two-turn ask/execute flow and the list of tools that need consent: `doc/agent/TURN.md`.

## Conventions

- **TypeScript** strict mode. `type` imports. No `any`.
- **Zod** for runtime validation. Schemas in `packages/shared/`.
- **Biome** for formatting/linting (not ESLint/Prettier). Run `pnpm check` before commit.
- **Drizzle ORM** with PostgreSQL. Migrations in `packages/db/drizzle/`.

## Doc Consistency

If code contradicts `doc/` files, flag it before proceeding. **Never modify `CLAUDE.md` or `doc/` without explicit user approval.**

## Verification

Run before claiming done:

```bash
pnpm typecheck && pnpm check && pnpm test && pnpm build
```
