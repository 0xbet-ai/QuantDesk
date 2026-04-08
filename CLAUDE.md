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
- `doc/PLAN.md` — TDD implementation phases with done-when criteria
- `doc/REFERENCES.md` — Paperclip, Hipocampus, Freqtrade, etc.

## Dev Setup

Prerequisites: Node.js 20+, pnpm 9.15+, Docker (for engine executors only), Claude CLI (`claude`) or Codex CLI (`codex`).

```bash
pnpm install
pnpm dev
```

PostgreSQL runs in-process via `embedded-postgres` (data under `~/.quantdesk/pgdata`) — no Docker required for the database. Docker is reserved for engine executor containers (Freqtrade, Nautilus) spawned at runtime.

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
6. **Engine is internal** — never expose engine name (freqtrade, nautilus) to the user in UI. Users pick a **strategy mode** (`classic` or `realtime`); the system maps that to an engine behind the scenes.
7. **Supported engines: Freqtrade and Nautilus Trader only.** Hummingbot is explicitly out of scope. Generic engine remains as a fallback for venues with no managed engine, and supports backtest only (no paper trading).
8. **Strategy mode → engine mapping:**
   - `classic` → **Freqtrade** — candle-based polling strategies, TA indicators, minute-to-hour timeframes. Default/recommended. Freqtrade's `dry_run` mode shares the same code path as live, giving the highest paper fidelity.
   - `realtime` → **Nautilus** — event-driven strategies reacting to ticks and order book deltas, sub-second timeframes, market making, arbitrage, HFT. Uses `SandboxExecutionClient` for paper.
   - The onboarding wizard asks the user to pick a mode **between venue selection and strategy selection**. When a venue supports both engines, the mode choice decides which engine is used. When a venue only supports one mode, the other mode is disabled for that venue.
9. **Paper trading uses engine-native paper modes** — never build a custom paper trading simulator. Freqtrade `dry_run: true` and Nautilus `SandboxExecutionClient`. Generic engine has no paper trading support (backtest only).
10. **One mode per desk** — each desk pins a single `strategy_mode` (and therefore a single engine) at creation time. Both are **immutable** for the desk's lifetime, enforced at the app level in `services/desks.ts`. All runs (backtest + paper) within the desk use the pinned engine. This guarantees backtest↔paper fidelity consistency and prevents cross-engine comparison confusion.
11. **Engines run in Docker** — engine processes (backtest AND paper trading) execute inside Docker containers using official engine images with **pinned version tags** (never `:latest`). Never install Freqtrade or Nautilus natively on the host. Rationale: isolation of LLM-generated strategy code, reproducibility, simplified user setup. The server, UI, and Claude/Codex CLI run on the host — only the engine layer is containerized.
12. **Paper session recovery** — paper runs may live for days. Containers are tagged with labels (`quantdesk.runId`, `quantdesk.engine`, `quantdesk.kind=paper`) so the server reconciles running containers on restart via `docker ps` rather than marking them as failed. The in-memory registry is rebuilt from Docker as the source of truth.
13. **First-run data fetch is agent-proposed, user-approved.** For any brand-new desk with no strategy code and no registered dataset, the agent's FIRST response must be a `[PROPOSE_DATA_FETCH] {...} [/PROPOSE_DATA_FETCH]` block containing `{exchange, pairs, timeframe, days, tradingMode, rationale}`. The agent must then stop and wait — it must not write code or emit `[RUN_BACKTEST]` until a user-approved fetch has completed. The UI renders this proposal as inline Approve/Reject buttons. On approve, the server runs the engine-specific download (classic → freqtrade `download-data` in a container; realtime → Nautilus DataCatalog; generic → agent fetches via its own tools), registers a Dataset row, and posts a system comment that re-triggers the agent to continue with strategy authoring and `[RUN_BACKTEST]`. On reject, the agent is re-triggered so it can propose a revised dataset. The server does **not** silently auto-download — the agent owns the decision of venue/pair naming/timeframe/history window, and the user owns the approval.
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
