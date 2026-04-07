# QuantDesk

AI-agent workspace for quantitative trading. Research, backtest, and validate strategies through async interaction with AI agents. **Paper trading only** — live trading is an explicit non-goal.

See [`CLAUDE.md`](./CLAUDE.md) for project rules and [`doc/`](./doc) for architecture.

## Install

Prerequisites: Node.js 20+, pnpm 9.15+, Docker (running), Claude CLI (`claude`) or Codex CLI (`codex`).

```bash
git clone <this-repo> QuantDesk
cd QuantDesk
pnpm install
pnpm onboard      # checks Docker and pre-pulls engine images (freqtrade, nautilus)
pnpm db:migrate
pnpm dev
```

The embedded Postgres boots in-process on first `pnpm dev` — no Docker needed for the database. Docker is used exclusively for engine executor containers.

## Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start server + UI |
| `pnpm onboard` | Check Docker and pull engine images |
| `pnpm build` | Build all packages |
| `pnpm typecheck` | TypeScript type checking |
| `pnpm check` | Biome lint + format |
| `pnpm test` | Vitest test suite |
| `pnpm db:migrate` | Run Drizzle migrations |
| `pnpm db:reset` | Reset embedded DB and re-seed |
