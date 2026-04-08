# 17 — Paper UI wiring + desk header widget (TODO)

## Tests first

1. `[PROPOSE_GO_PAPER]` → user clicks Approve in the comment thread → `POST /api/comments/:id/approve` → `paperSessions` row created (round-trip integration test).
2. The desk header surfaces a live paper widget with the latest `PaperStatus` while a session is `running`.
3. The Stop button transitions the session, tears the container down, and removes the widget.
4. The header pending-decision badge from rule #15 still shows for any unresolved proposal alongside the paper widget.

## Then implement

- Approval handler is already wired in phase 13. This phase is the UI side.
- React component for the paper widget.
- WebSocket / SSE subscription for live `PaperStatus` updates.
- Stop button → `POST /api/paper-sessions/:id/stop`.
