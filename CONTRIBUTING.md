# Contributing to QuantDesk

Thanks for your interest in contributing! QuantDesk is an open-source AI-agent workspace for quantitative trading, and we welcome contributions of all sizes — from fixing typos to adding new engine adapters.

## Quick Links

- **Add a new exchange/venue** → [doc/contributing/ADD_VENUE.md](doc/contributing/ADD_VENUE.md) — typically a one-line JSON change, great first contribution.
- **Add a new engine** → [doc/contributing/ADD_ENGINE.md](doc/contributing/ADD_ENGINE.md) — implement the engine adapter interface.
- **Architecture overview** → [doc/architecture/OVERVIEW.md](doc/architecture/OVERVIEW.md)
- **Engine adapter spec** → [doc/architecture/ENGINE_ADAPTER.md](doc/architecture/ENGINE_ADAPTER.md)

## Development Setup

Prerequisites: **Node.js 20+**, **pnpm 9.15+**, **Docker**, and either the **Claude CLI** (`claude`) or **Codex CLI** (`codex`) for the agent layer.

```bash
git clone https://github.com/<your-fork>/QuantDesk.git
cd QuantDesk
pnpm install
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

This starts both the server (port 3000) and the UI in dev mode.

## Workflow

1. **Fork** the repository and create a topic branch from `main`.
2. **Make your changes.** Keep PRs focused — one logical change per PR.
3. **Run verification** before pushing:
   ```bash
   pnpm typecheck && pnpm check && pnpm test && pnpm build
   ```
4. **Commit** using the convention below.
5. **Open a PR** against `main`. Reference any related issues.

## Commit Messages

Format: `<type>: <description>`

Types:
- `feat` — new feature
- `fix` — bug fix
- `refactor` — code change that neither fixes a bug nor adds a feature
- `docs` — documentation only
- `chore` — tooling, dependencies, build config

Examples:
- `feat: add Interactive Brokers venue for Nautilus engine`
- `fix: handle null result in DeskPanel.bestReturn`
- `docs: clarify engine adapter lifecycle`

## Code Style

- **English only** — all code, comments, strings, docs, and commit messages.
- **TypeScript strict mode** — no `any`. Use `type` imports where applicable.
- **Biome** for formatting and linting (not ESLint/Prettier). Run `pnpm check` before committing.
- **Zod** for runtime validation. Schemas live in `packages/shared/`.
- **Drizzle ORM** for database access. Migrations live in `packages/db/drizzle/`.
- **File references** in docs/comments use repo-root-relative paths (`src/core/runner.ts:42`), never absolute paths.

## Documentation Rules

- Never modify `CLAUDE.md` or files under `doc/` without explicit discussion in the PR.
- If your code change makes existing docs incorrect, update the docs in the same PR.

## What to Contribute

Good first contributions:
- **Add a venue** to `strategies/venues.json` — see [ADD_VENUE.md](doc/contributing/ADD_VENUE.md).
- **Fix typos** in docs or UI strings.
- **Add a strategy entry** to one of the `strategies/<engine>.json` catalogs.

Larger contributions (please open an issue first to discuss):
- **New engine adapter** — see [ADD_ENGINE.md](doc/contributing/ADD_ENGINE.md).
- **New agent role** (beyond Analyst / Risk Manager).
- **New page or major UI feature.**

## Reporting Bugs

Open a GitHub issue with:
- A clear description of what you expected vs. what happened.
- Steps to reproduce.
- Your OS, Node version, and engine versions if relevant.
- Logs from `pnpm dev` if applicable.

## Code of Conduct

Be respectful. Assume good intent. Disagreements about technical direction are welcome — personal attacks are not.

## Questions?

Open a GitHub Discussion or issue. Maintainers usually respond within a few days.
