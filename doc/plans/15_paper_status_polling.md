# 15 — Paper status polling (TODO)

## Tests first

1. While a session is `running`, `pollPaperStatus()` calls `engineAdapter.getPaperStatus()` and persists a normalized `PaperStatus` row.
2. Polling cadence is configurable.
3. Polling stops when the session leaves `running`.
4. Failure to poll (engine API down) → session row stays `running` but `lastStatusAt` is not advanced; no false `failed` transitions.

## Then implement

- `paperStatuses` table (or reuse an observability table if one exists in the schema).
- Background poller scoped to active sessions only — kicked off from the boot reconcile in phase 14 and from `startPaperSession` in phase 13.
