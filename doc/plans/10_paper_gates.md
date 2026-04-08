# 10 — `paper-sessions` service: promotion gates (TODO)

Spec: `doc/agent/PAPER_LIFECYCLE.md`. Pure DB + invariant logic, no Docker calls (phase 11 owns that).

## Tests first

1. `startPaperSession(runId)` rejects when the source run is not marked validated (validation lands in phase 08).
2. `startPaperSession` rejects when the desk already has a `running` session (one-paper-per-desk invariant).
3. Happy path: returns a `pending` `paperSessions` row.
4. `stopPaperSession(sessionId)` transitions a `running` session to `stopped` and stamps `stoppedAt`.
5. `getActiveSession(deskId)` returns the single active session or null.

## Then implement

- `server/src/services/paper-sessions.ts` with `startPaperSession`, `stopPaperSession`, `getActiveSession`.
- All side effects pure DB; no engine adapter calls yet.
