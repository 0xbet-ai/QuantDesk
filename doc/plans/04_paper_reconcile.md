# 04 — Paper sessions: boot-time reconcile (TODO)

Spec: rule #12. Paper containers must survive a server restart.

## Tests first

1. Given a `paperSessions` row in `running` and a live container with the
   matching `quantdesk.kind=paper` label, the boot reconciler keeps it `running`.
2. Given a `running` row whose container is gone, the reconciler transitions it
   to `failed` with a reason.
3. Given a live labelled container with no matching DB row, the reconciler
   stops it (it is an orphan).

## Then implement

- `reconcilePaperSessions()` called from `server/src/index.ts` startup.
- Uses `docker ps --filter label=quantdesk.kind=paper --format=json`.
