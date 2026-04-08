# 03 — Paper sessions: container launch (TODO)

## Tests first

1. `startPaperSession` invokes the engine adapter's `startPaper()` and stores the
   returned `containerId` on the `paperSessions` row.
2. The launched container carries `quantdesk.runId`, `quantdesk.deskId`,
   `quantdesk.engine`, `quantdesk.kind=paper` labels (already true for Freqtrade;
   verify Nautilus parity).
3. `stopPaperSession` calls the adapter's `stopPaper()`, transitions status to
   `stopped`, sets `stoppedAt`.

## Then implement

- Wire the service from phase 02 to `EngineAdapter.startPaper` / `stopPaper`.
- Add the missing labels to the Nautilus adapter if absent.
