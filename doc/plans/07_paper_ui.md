# 07 — Paper sessions: UI wiring (TODO)

## Tests first

1. `[PROPOSE_GO_PAPER]` → user approval click → `POST /api/desks/:id/paper`
   → `paperSessions` row created.
2. Desk view shows the active session and its latest status.
3. Stop button transitions the session and tears the container down.

## Then implement

- Approval handler in the agent comment renderer.
- Desk-level paper widget.
