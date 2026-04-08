# 18 — Generic `downloadData` must run inside the container (BUG)

Spec: `doc/engine/README.md` Generic section — "Agent-authored download script executed **inside the generic Ubuntu+Python container**."

Current code (`packages/engines/src/generic/adapter.ts`): `downloadData` runs `bash <workspacePath>/download-data.sh` directly on the host via `execAsync`. This contradicts the spec — host-native execution leaks the host's environment, breaks pinning, and gives the agent's downloader unrestricted host access. Per CLAUDE.md rule #11 this is a code BUG.

## Tests first

1. Given a generic workspace containing `download.{py,ts,js}`, `downloadData(proposal)` spawns the pinned generic Docker image, mounts the workspace at `/workspace`, and invokes the script with the proposal JSON on stdin (or argv — pin one and document it).
2. The script's exit code is propagated: non-zero → `downloadData` rejects with the captured stderr in the error.
3. The script writes data files into `/workspace/data/` and the adapter returns the resolved paths so the server can insert/extend the global `datasets` row.
4. Missing `download.{py,ts,js}` → clear error ("generic desk is missing a downloader script"), not a silent no-op.
5. The host shell is never invoked — `execAsync('bash …')` is gone.

## Then implement

- Replace the `downloadData` body with a Docker spawn mirroring `freqtrade/adapter.ts`'s download path.
- Document the `download.{py,ts,js}` contract (file location, input format, output paths, exit-code semantics) in the existing Generic section of `doc/engine/README.md`.
