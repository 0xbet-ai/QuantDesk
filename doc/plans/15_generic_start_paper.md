# 15 — Generic paper: `startPaper` (BUG)

Spec: `doc/engine/README.md` — generic desks run agent-authored paper scripts in
a long-lived labelled container. Today
`packages/engines/src/generic/adapter.ts` throws `"not supported"`. Per rule #14
this is a code bug, not a doc problem.

## Tests first

1. Given a generic workspace containing `paper.py`, `startPaper()` launches a
   detached container with the `quantdesk.kind=paper` label and the four
   standard labels set.
2. The container mounts the desk workspace read-write at `/workspace`.

## Then implement

- Replace the throwing `startPaper` stub with a Docker call mirroring Freqtrade.
