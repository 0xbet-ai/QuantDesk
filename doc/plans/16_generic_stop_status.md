# 16 — Generic paper: `stopPaper` + `getPaperStatus` (BUG)

## Tests first

1. `stopPaper()` SIGTERMs then `docker rm`s the container.
2. `getPaperStatus()` reads `status.json` written by the agent script and
   returns a normalized `PaperStatus`.

## Then implement

- Replace the two remaining throwing stubs.
- Document the `paper.{py,ts,js}` and `status.json` contract in the existing
  `doc/engine/README.md` section (no new doc files).
