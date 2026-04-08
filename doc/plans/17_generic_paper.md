# 17 — Generic `startPaper` / `stopPaper` / `getPaperStatus` (BUG)

Spec: `doc/engine/README.md` Generic section — "paper scripts run long-lived with the same `quantdesk.kind=paper` labels managed engines use." Current code in `packages/engines/src/generic/adapter.ts` throws `"does not support paper trading"` from all three methods. Per CLAUDE.md rule #14 this is a code BUG.

## Tests first

1. Given a generic workspace containing `paper.{py,ts,js}`, `startPaper()` launches a detached generic container with the four standard labels (`quantdesk.runId`, `quantdesk.deskId`, `quantdesk.engine`, `quantdesk.kind=paper`).
2. The container mounts the desk workspace read-write at `/workspace`.
3. `stopPaper()` SIGTERMs then `docker rm`s the container.
4. `getPaperStatus()` reads `status.json` written by the agent script and returns a normalized `PaperStatus`.
5. Missing `paper.{py,ts,js}` → clear error.

## Then implement

- Replace the three throwing stubs with real Docker calls mirroring the Freqtrade adapter shape.
- Document the `paper.{py,ts,js}` and `status.json` contract in the existing Generic section of `doc/engine/README.md` (no new doc files).
