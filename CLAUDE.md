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
- `doc/agent/LIFECYCLE.md` — turn-to-turn lifecycle, marker branching, fragile spots
- `doc/agent/PAPER_LIFECYCLE.md` — long-running paper trading state machine, observer turns, reconcile
- `doc/agent/MARKERS.md` — protocol glossary for the bracketed markers the agent emits
- `doc/agent/ROLES.md` — Analyst, Risk Manager, interaction pattern
- `doc/agent/MEMORY.md` — hipocampus-inspired long-term context
- `doc/engine/README.md` — pluggable engine adapter interface (incl. per-engine workspace layout)
- `doc/desk/STORAGE.md` — where a desk's state lives on disk and in the database
- `doc/PLAN.md` — gaps between current code and spec (the only place hedging language is allowed)
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
7. **Managed engine whitelist is closed.** The set of supported engines is fixed and defined in `doc/engine/README.md`. No new managed adapters will be added.
8. **Mode is picked before strategy, after venue.** The mode → engine mapping and wizard flow live in `doc/engine/README.md`.
9. **No custom paper trading simulator.** Managed desks use engine-native paper modes; generic desks run agent-authored paper scripts. Details in `doc/engine/README.md`.
10. **One mode per desk, immutable.** Each desk pins `strategy_mode` (and therefore its engine) at creation time; both are immutable for the desk's lifetime, enforced in `services/desks.ts`. This guarantees backtest↔paper fidelity and prevents cross-engine comparison confusion.
11. **Engines run in Docker with pinned images.** Never install any engine natively on the host; never use `:latest`. The server, UI, and agent CLI run on the host — only the engine layer is containerized. Image pinning and per-engine specifics: `doc/engine/README.md`.
12. **Paper sessions must survive server restart.** Paper containers are tagged so they can be reconciled after a restart instead of being marked failed. Label set and reconcile mechanism: `doc/engine/README.md` and `doc/agent/PAPER_LIFECYCLE.md`.
13. **First-run data fetch is agent-proposed, user-approved.** For a brand-new desk the agent's first response must be a `[PROPOSE_DATA_FETCH]` block and the agent must then stop and wait — no code, no `[RUN_BACKTEST]` — until the user approves and the server completes the download. The server never silently auto-downloads: the agent owns the decision, the user owns the approval. Full flow in `doc/agent/LIFECYCLE.md` Stage 1.
14. **Docs are the spec, code follows.** `doc/` describes the intended system in the present tense as if it were fully implemented. Never write "TODO", "planned", "not yet implemented", "coming soon", "awaiting", or similar hedging language in any doc **except `doc/PLAN.md`**, which is the single place where gaps between spec and current code are tracked. If the code contradicts a doc, the default is to fix the code — not the doc — unless the user explicitly approves a spec change. When you discover an unimplemented spec item, add it to `doc/PLAN.md` rather than weakening the spec document.

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
