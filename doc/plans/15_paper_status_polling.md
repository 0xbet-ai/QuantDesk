# 15 — Paper status polling (DONE — superseded by market tick + log stream)

The original spec called for a server-side background poller that
periodically queries `engineAdapter.getPaperStatus()` and persists
rows into a `paperStatuses` table. That approach was **superseded** by
a more capable mechanism built during the paper-trading observability
overhaul:

## What was implemented instead

1. **Market tick (5-second cadence)** — `paper-sessions.ts` attaches a
   `setInterval` per running session that calls
   `adapter.getPaperMarketTickLine()` every 5 seconds. The one-liner
   (`[market] <pollTime> <pair> <tf> close=... adx=... signal=...`)
   is published as a `paper.log` WebSocket event AND appended to the
   experiment's agent log. Configurable via
   `paper.marketTickIntervalMs` in global config.

2. **Container log streaming** — `followLogs()` spawns `docker logs -f`
   per running session and forwards every stdout/stderr line as a
   `paper.log` event. Freqtrade heartbeats, entry/exit RPC messages,
   and errors flow to the UI in real time — no polling gap.

3. **UI rendering** — `PaperTradingView` subscribes to `paper.log`
   events via WebSocket and renders them in a resizable log panel with
   color-coded log levels (INFO=green, WARNING=yellow, ERROR=red),
   localized timestamps, and auto-scroll.

4. **Boot reconcile re-attach** — `reconcilePaperSessions()` re-attaches
   both the log stream and the market ticker for sessions that survived
   a server restart.

5. **Heartbeat proxy** — `run_backtest` and `run_script` MCP handlers
   bump the agent turn's `last_heartbeat_at` on every Docker stdout
   line (throttled to 5s), preventing false watchdog timeouts during
   long container runs. `PYTHONUNBUFFERED=1` is set on all containers
   so Python flushes stdout on every write.

## Why the original spec is fully covered

| Original spec item | Coverage |
|--------------------|----------|
| Server polls `getPaperStatus()` periodically | Market tick polls `getPaperMarketTickLine()` every 5s — same engine API, richer output |
| Cadence is configurable | `paper.marketTickIntervalMs` in `config.json` |
| Polling stops when session leaves `running` | `detachPaperMarketTicker()` on stop/fail |
| Failure to poll doesn't cause false `failed` | Market tick catches errors silently; session status unchanged |
| `lastStatusAt` column updated | **Not used** — market tick publishes to WebSocket + agent log instead of DB column. The column exists but is dead; can be dropped in a future migration or repurposed for server-side observability if needed. |

## Remaining gap (deferred, non-critical)

Server does not proactively mark a session `failed` when the container
dies between boot reconciles. The UI detects it via the `/paper/status`
endpoint returning `null` (10-second poll). For a dry-run-only system
this is acceptable — no money is at risk and the user sees the stale
state within seconds of opening the UI.
