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
- `doc/agent/MARKERS.md` — protocol glossary for the bracketed markers the agent emits
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

## Rules

1. **English only** — all code, comments, strings, docs, commits.
2. **File refs** — repo-root relative (`src/core/runner.ts:42`), never absolute.
3. **Commits** — `<type>: <description>`. Types: `feat`, `fix`, `refactor`, `docs`, `chore`.
4. **Secrets** — never commit. Use env vars. `.env` is gitignored.
5. **Scope** — backtesting and paper trading only. **Live trading is an explicit forever non-goal** — never implement, design for, or expose real-money trading in APIs or UI. No API keys for trading, no custody, no order routing to real venues.
6. **Engine is internal** — never expose engine names to the user in UI. Users pick a **strategy mode** (`classic` or `realtime`); the system maps that to a managed engine behind the scenes. The full mode → engine mapping and the whitelist of supported engines live in `doc/engine/README.md`.
7. **Managed engine whitelist is closed.** Current set: Freqtrade, Nautilus, Generic (see `doc/engine/README.md`). Adding a new managed adapter requires explicit user approval and following `doc/engine/ADD.md`. Default answer to "should we add engine X?" is **no** — try the generic engine first.
8. **One mode per desk, immutable.** Each desk pins `strategy_mode` (and therefore its engine) at creation time; both are immutable for the desk's lifetime, enforced in `services/desks.ts`. Guarantees backtest↔paper fidelity.
9. **Engines run in Docker with pinned images.** Never install engines natively on the host; never use `:latest`. Only the engine layer is containerized — server, UI, and agent CLI run on the host. Per-engine specifics: `doc/engine/README.md`.
10. **Paper sessions must survive server restart.** Paper containers are tagged so they can be reconciled after a restart instead of being marked failed. Label set and reconcile mechanism: `doc/engine/README.md` and `doc/agent/PAPER_LIFECYCLE.md`.
11. **Docs are the spec, code follows.** `doc/` describes the system in present tense as if fully implemented. Hedging language (`TODO`, `planned`, `not yet implemented`, etc.) is only allowed under `doc/plans/`, which tracks gaps between spec and code. If code contradicts a doc, fix the code unless the user approves a spec change. **Phase lifecycle:** finished phase files (tests pass, code merged) are deleted from `doc/plans/` and replaced with a one-line entry under the DONE section of `doc/plans/README.md`.
12. **No user dead-ends.** Every lifecycle branch — including failures, rejections, and terminal turns — must surface a clear next action. When a turn ends without automatic retrigger, the state must satisfy one of: (a) the agent's last message ends with a concrete question; (b) a system comment names the next move; (c) the agent is in the retrigger queue. Silent pauses are spec violations.
13. **Approval is conversational.** User consent lives in plain-text replies — no structured proposals, no approve/reject buttons. The server renders no approval UI. Once the user agrees, the agent emits the action marker on the next turn. Full flow and the list of markers that need consent: `doc/agent/MARKERS.md` "Conversational approval".

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
