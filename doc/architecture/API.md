# API

## HTTP

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/desks | Create desk |
| GET | /api/desks | List desks |
| GET | /api/desks/:id | Desk detail |
| PATCH | /api/desks/:id | Update desk (name, description, budget, target, stop-loss, venues) |
| GET | /api/desks/:id/experiments | List experiments |
| POST | /api/desks/:id/experiments | Create experiment |
| GET | /api/experiments/:id | Experiment detail |
| GET | /api/experiments/:id/runs | List runs |
| POST | /api/experiments/:id/comments | Post comment (triggers agent) |
| GET | /api/experiments/:id/comments | Comment thread |
| GET | /api/strategies | Catalog strategies |
| POST | /api/runs/:id/go-paper | Approve strategy for paper trading |
| POST | /api/runs/:id/stop | Stop a paper trading run |
| GET | /api/runs/:id/status | Paper run status and metrics |

## WebSocket

```
ws://localhost:3000/api/experiments/:experimentId/events/ws
```

One-way broadcast. No client-to-server messages.

Events:
- `run.status` — run started / completed / stopped / failed
- `run.paper` — paper trading metrics update (P&L, position, etc.)
- `comment.new` — new comment posted by agent
