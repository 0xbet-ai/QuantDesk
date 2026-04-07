# API

## HTTP

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/desks | Create desk (body includes `strategy_mode`) |
| GET | /api/desks | List desks |
| GET | /api/desks/:id | Desk detail |
| PATCH | /api/desks/:id | Update desk (name, description, budget, target, stop-loss, venues). **`strategy_mode` and `engine` are immutable and rejected with 400 if present in the body.** |
| GET | /api/desks/:id/experiments | List experiments |
| POST | /api/desks/:id/experiments | Create experiment |
| GET | /api/experiments/:id | Experiment detail |
| GET | /api/experiments/:id/runs | List runs |
| POST | /api/experiments/:id/comments | Post comment (triggers agent) |
| GET | /api/experiments/:id/comments | Comment thread |
| GET | /api/strategies?mode=classic\|realtime&venues=... | Catalog strategies, filtered by strategy mode and venues |
| POST | /api/runs/:id/go-paper | Approve strategy for paper trading (400 if desk engine is `generic`) |
| POST | /api/runs/:id/stop | Stop a paper trading run |
| GET | /api/runs/:id/status | Paper run status and metrics |

### `POST /api/desks` body

```json
{
  "name": "BTC Trend Follow",
  "description": "...",
  "budget": 10000,
  "target_return": 15,
  "stop_loss": 5,
  "venues": ["binance"],
  "strategy_mode": "classic",
  "strategy_id": "freqtrade_adx_baseline"
}
```

- `strategy_mode` is required: `"classic"` or `"realtime"`.
- The server validates that all selected `venues` support the chosen `strategy_mode` via `availableModes(venue)`. Rejected with 400 if not.
- The server derives `engine` from `strategy_mode` (`classic` → `freqtrade`, `realtime` → `nautilus`, or `generic` fallback for venues with no managed engine) and writes it to `desks.engine`. Both fields are immutable thereafter.

## WebSocket

```
ws://localhost:3000/api/experiments/:experimentId/events/ws
```

One-way broadcast. No client-to-server messages.

Events:
- `run.status` — run started / completed / stopped / failed / **interrupted**
- `run.paper` — paper trading metrics update (unrealizedPnl, realizedPnl, openPositions, uptime)
- `comment.new` — new comment posted by agent

`interrupted` indicates a paper container disappeared due to external causes (manual `docker rm`, host reboot, image upgrade) — distinct from `failed` (strategy/engine error).
