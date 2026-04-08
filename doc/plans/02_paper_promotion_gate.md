# 02 — Paper sessions: promotion gate (TODO)

Spec: rule that paper trading only follows a validated backtest.

## Tests first

1. `startPaperSession(runId)` rejects when the source run is not marked validated.
2. `startPaperSession` rejects when the desk already has a `running` session
   (one-paper-per-desk invariant).
3. Happy path: returns a `pending` `paperSessions` row.

## Then implement

- `server/src/services/paper-sessions.ts` with `startPaperSession` /
  `stopPaperSession` / `getActiveSession(deskId)`.
- No Docker calls yet — this phase is pure DB + invariant logic.
