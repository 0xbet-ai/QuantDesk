# 05 — Paper sessions: status polling (TODO)

## Tests first

1. While a session is `running`, `pollPaperStatus()` calls
   `EngineAdapter.getPaperStatus()` and persists a normalized `PaperStatus` row.
2. Polling cadence is configurable and stops when the session leaves `running`.

## Then implement

- `paperStatuses` table (or reuse an existing observability table if one exists).
- Background poller scoped to active sessions only.
