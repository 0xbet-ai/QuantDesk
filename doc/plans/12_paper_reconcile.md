# 12 — Boot-time paper reconcile (TODO)

Spec: CLAUDE.md rule #12 ("Paper sessions must survive server restart").

## Tests first

1. Given a `paperSessions` row in `running` and a live container with the matching `quantdesk.kind=paper` label, the boot reconciler keeps the row in `running`.
2. Given a `running` row whose container is gone, the reconciler transitions it to `failed` with a reason and posts a rule #15 system comment ("Container exited. Reply to investigate.").
3. Given a live labelled container with no matching DB row, the reconciler stops it (it is an orphan).

## Then implement

- `reconcilePaperSessions()` called from `server/src/index.ts` startup.
- Uses `docker ps --filter label=quantdesk.kind=paper --format=json`.
- Idempotent — running it twice in a row produces no diff.
