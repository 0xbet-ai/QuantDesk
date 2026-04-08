# 19 — Generic engine: `downloadData` via agent-authored fetcher (TODO)

Spec: `doc/engine/README.md` Generic section + `doc/agent/MARKERS.md` row P1.
The marker truth table now routes **every** data fetch through
`engineAdapter.downloadData(proposal)`, regardless of engine. For Freqtrade and
Nautilus this already maps to a real downloader. For Generic the spec says it
should spawn the agent-authored `download.{py,ts,js}` script inside the generic
container — verify this is what the adapter actually does, and fill any gap.

## Tests first

1. Given a generic workspace containing `download.py`, `engineAdapter.downloadData(proposal)`
   spawns the generic container, mounts the workspace at `/workspace`, and
   invokes `python download.py` with the proposal JSON on stdin (or as argv —
   pick one and pin it).
2. The script's exit code is propagated: non-zero → `downloadData` rejects.
3. The script writes data files into `/workspace/data/` and the adapter returns
   the resolved paths so the server can insert/extend the global `datasets`
   row.
4. Missing `download.{py,ts,js}` → clear error ("generic desk is missing a
   downloader script"), not a silent no-op.

## Then implement

- Audit `packages/engines/src/generic/adapter.ts` `downloadData()`. If it
  already matches the spec, just add the tests. If not, replace the body with
  the contract above.
- Document the `download.{py,ts,js}` contract (file location, input format,
  output paths, exit-code semantics) in the existing Generic section of
  `doc/engine/README.md` — no new doc files.
