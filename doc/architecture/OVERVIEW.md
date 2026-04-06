# Architecture Overview

pnpm monorepo. Agents are AI CLI subprocesses triggered by user comments (request -> execute -> respond). See `doc/REFERENCES.md` for architectural influences.

## Tech Stack

| Layer | Choice |
|-------|--------|
| Monorepo | pnpm workspaces |
| Backend | Express.js + WebSocket (ws) |
| Database | PostgreSQL 17, Drizzle ORM |
| Frontend | React 19, Vite, Tailwind CSS, Radix UI |
| Validation | Zod |
| Testing | Vitest |
| Linting | Biome |
| AI Adapter | AI CLI subprocess |

## Repo Map

```
quantdesk/
├── cli/                          # npx quantdesk — onboard, start
├── server/                       # Express API + WebSocket
│   ├── routes/                   # desks, experiments, runs, comments, strategies
│   ├── services/                 # agent-runner, engine-runner, memory
│   ├── middleware/               # auth (local-trust for now)
│   └── realtime/                 # WebSocket one-way broadcast
├── ui/                           # React SPA (Vite)
│   ├── pages/                    # DeskList, DeskDetail, Onboarding
│   ├── components/               # RunTable, CommentThread, ExperimentList
│   └── context/                  # LiveUpdatesProvider
├── packages/
│   ├── db/                       # Drizzle ORM schema + migrations
│   ├── adapters/                 # AI CLI subprocess adapters (claude, codex)
│   ├── engines/                  # engine adapters (freqtrade, hummingbot, nautilus, generic)
│   ├── adapter-utils/            # child process, log parsing
│   └── shared/                   # Zod schemas, cross-package types
├── strategies/                   # curated catalog JSON + venues.json + template code
├── workspaces/                   # per-desk git repos (strategy code + data)
├── docker-compose.yml            # PostgreSQL
└── package.json                  # pnpm workspace root
```
