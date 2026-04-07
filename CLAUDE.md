# CLAUDE.md

## Purpose

QuantDesk is an AI-agent workspace for quantitative trading.
Users research, backtest, and validate strategies through async interaction with AI agents (Analyst, Risk Manager).

- **Strategy Desk**: Workspace with budget (USD), target return, and stop-loss constraints. Pick from a curated catalog or generate a custom strategy from natural language.
- **Experiments & Runs**: Organize work into experiments (research threads) within a desk. Each experiment tracks multiple backtest runs with normalized results for comparison.
- **Dataset Management**: Reusable market data scoped per desk — exchange, pairs, timeframe, and date range. Shared across runs.
- **Code Versioning**: Per-desk git workspace. Agent commits strategy code on every change; each run links to its exact commit hash.
- **Paper Trading**: User approves a validated strategy to start paper trading. Engine runs the strategy in paper mode.
- **Engine Adapters**: Pluggable engines for backtesting and paper trading. See `doc/architecture/ENGINE_ADAPTER.md`.
- **Agent Layer**: AI CLI subprocess with session persistence and hipocampus-inspired memory compaction.

## Read This First

Product:
1. `doc/product/USER_FLOW.md` — onboarding, desks, experiments, runs
3. `doc/product/UI_LAYOUT.md` — 3-column layout
4. `doc/product/DOMAIN_MODEL.md` — DB schema (Desk, Experiment, Run, Dataset, Comment, ...)
5. `doc/product/AGENTS.md` — Analyst, Risk Manager, interaction pattern

Plan:
- `doc/PLAN.md` — TDD implementation phases with done-when criteria

References:
- `doc/REFERENCES.md` — Paperclip, Hipocampus, Freqtrade, etc.

Architecture:
1. `doc/architecture/OVERVIEW.md` — tech stack, repo map
2. `doc/architecture/AGENT_EXECUTION.md` — AI CLI subprocess, session management
3. `doc/architecture/WORKSPACE.md` — per-desk git repos, code/data versioning
4. `doc/architecture/ENGINE_ADAPTER.md` — pluggable engine adapter interface
5. `doc/architecture/API.md` — HTTP routes, WebSocket events
6. `doc/architecture/MEMORY.md` — hipocampus-inspired long-term context

## Dev Setup

Prerequisites: Node.js 20+, pnpm 9.15+, Docker, Claude CLI (`claude`) or Codex CLI (`codex`).

```bash
pnpm install
docker compose up -d postgres
pnpm dev
```

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
5. **Scope** — backtesting and paper trading.
6. **Engine is internal** — never expose engine name (freqtrade, hummingbot, etc.) to the user in UI. Engine is resolved by the agent behind the scenes.

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
