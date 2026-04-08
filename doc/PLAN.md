# PLAN.md

What is left to ship. `doc/` is the spec; code follows. Each entry below is a gap between current code and current spec, or work the spec mandates that the implementation does not yet do.

When an entry ships, delete it. When a new spec item lands, add one. This file is not a changelog — git is.

---

## Open work

### Data fetch — cache lookup with incremental fetch

Spec: `doc/desk/STORAGE.md` "Lookup and incremental fetch", `doc/agent/LIFECYCLE.md` Stage 1 (3 branches: full hit / partial / miss).

Code today (`server/src/services/data-fetch.ts`): exact `(exchange, pairs, timeframe, dateRange)` match only. Partial hit case is missing; an extending request inserts a new `datasets` row instead of widening the existing one.

Done when: a request whose `dateRange` extends the cached range downloads only the missing interval, the existing `datasets` row's `dateRange` is widened in place, and existing `desk_datasets` links keep pointing at the same row id.

### Data fetch — quality validation gate

Spec: `doc/agent/LIFECYCLE.md` Stage 1 "validate downloaded data" node.

Code today: only checks `exitCode` and `fileCount`. No gap / NaN / coverage / monotonic-timestamp checks. A failure does not currently stop the dataset insert.

Done when: a validation function returns `{ ok, errors }`; failure aborts the insert, posts a system comment with the failure summary, and re-triggers the agent so it can emit a revised `[PROPOSE_DATA_FETCH]`. Validation runs only on the agent-proposed download path, not on agent-self-emitted `[DATASET]` markers.

### Data fetch — server-side `[RUN_BACKTEST]` refusal for realtime / generic

Spec: CLAUDE.md rule #13 — server refuses `[RUN_BACKTEST]` until a dataset is registered for the desk.

Code today (`server/src/services/data-fetch.ts:46-56`): realtime / generic mode falls back to a graceful "ask the agent" comment instead of a hard refusal. classic mode refuses correctly. Make all three modes consistent.

### Risk Manager — `[PROPOSE_VALIDATION]` flow

Spec: `doc/agent/MARKERS.md` `[PROPOSE_VALIDATION]`, `doc/agent/ROLES.md` Risk Manager role.

Code today: the marker is defined in `packages/shared/src/agent-markers.ts` and taught to the agent in the prompt, but `agent-trigger.ts` does not extract or handle it — emitted markers are silently stripped.

Done when: server parses `[PROPOSE_VALIDATION]`, dispatches a Risk Manager turn against the latest run, and posts the validation verdict as a system comment that re-triggers the Analyst.

### Paper trading — `[RUN_PAPER]` marker handler

Spec: `doc/agent/MARKERS.md` lists `[RUN_PAPER] <runId>` as an action marker that starts a long-lived paper container.

Code today: `prompt-builder.ts` teaches the marker but `agent-trigger.ts` does not extract or handle it. Either wire the parser + handler or remove the marker from the spec — currently the spec promises something the server never honours.

### Paper trading — restart reconcile

Spec: CLAUDE.md rule #12 — paper containers carry `quantdesk.runId` / `quantdesk.engine` / `quantdesk.kind=paper` labels so the server reconciles via `docker ps` on restart.

Code today: containers are launched with the labels (`packages/engines/src/freqtrade/adapter.ts:223-227`), but no startup reconcile exists. Containers that vanished while the server was down are not marked `interrupted`; orphan containers are not detected.

Done when: on server start, `docker ps --filter label=quantdesk.kind=paper` rebuilds the in-memory `PaperProcessRegistry`; runs whose container is gone are marked `interrupted`; orphan containers are logged.

### Paper trading — live PnL poller

Spec: `doc/agent/PAPER_LIFECYCLE.md` (referenced from CLAUDE.md) — observer turns / live updates.

Code today: `getPaperStatus` exists per engine adapter but nothing polls it on a schedule and broadcasts to the UI. No `run_logs` rows of `type=pnl` are produced from a running paper session.

Done when: a poller calls `getPaperStatus` for every active handle on a fixed interval, appends `run_logs` (`type=pnl`), and broadcasts a `run.paper` WebSocket event.

### Engine — per-run container mount

Spec: `doc/engine/README.md` "Volumes" — the run's working directory is `<workspacePath>/runs/<runId>/`, mounted into the container.

Code today: `packages/engines/src/freqtrade/adapter.ts:140,169` mounts the entire desk workspace into the container instead of the per-run subdirectory. This weakens isolation between runs of the same desk.

### Engine — `--pids-limit` per container

Spec: `doc/engine/README.md` "Resource limits" — `--cpus`, `--memory`, `--pids-limit` per container.

Code today: `packages/engines/src/freqtrade/adapter.ts:141` and `packages/engines/src/nautilus/adapter.ts:117` do not set `--pids-limit`. Add it across all engine adapters.

### Memory — desk-level summary chaining

Spec: `doc/agent/MEMORY.md`.

Code today: experiment-level summary is generated on `[PROPOSE_COMPLETE_EXPERIMENT]` approval. Token counter, dynamic N selection in the prompt builder, and desk-level summary chaining are not done.

Done when: the prompt builder loads as many recent comments as fit a token budget, falls back to summaries for older content, and a desk-level summary is regenerated whenever an experiment summary changes.

### CLI — `start` command

Code today: `npx quantdesk onboard` exists; `npx quantdesk start` does not. Currently users have to `pnpm dev` from a clone.

Done when: `npx quantdesk start` launches the server and serves the UI on the configured port, with a friendly first-run check that warns if `onboard` was never run.

---

## Decisions to make

These are open product / design questions, not implementation gaps. Each blocks the corresponding open-work entry until resolved.

- **`PaperConfig` shape.** Today `PaperConfig` carries `runId`, `pairs`, `exchange`, `timeframe` as fields on the config object. Alternative: read pairs / exchange / timeframe from the workspace's engine config file (`config.json` for Freqtrade, `config.py` for Nautilus). The current shape is simpler for the server to orchestrate; the alternative removes the desk/engine duplication risk. Pick one before touching the paper-trading pipeline.
- **Risk Manager scope.** The role and the `[PROPOSE_VALIDATION]` marker are spec'd, but the wiring is unbuilt and the user does not want a per-backtest validation prompt. Decide whether validation is triggered at baseline-only, at `[PROPOSE_GO_PAPER]` time, on agent-detected anomalies only, or removed entirely.
- **Recursion budget on agent retriggers.** `agent-trigger.ts` retriggers the agent fire-and-forget after a backtest. The spec ("LIFECYCLE — Failure handling") says retry is always agent-driven and user-gated, never a silent server loop. That matches today's code, but a misbehaving agent that keeps emitting `[RUN_BACKTEST]` after a failure has no explicit ceiling. Decide whether to add a per-turn or per-experiment depth limit.

---

## Out of scope for now

- **E2E integration tests.** Removed as a standalone phase. E2E coverage will fall out of feature work and the existing per-service tests; we are not blocking on a separate e2e harness for MVP.
- **Docker sandbox for agent execution.** Currently the agent runs on the host. Containerising the agent itself is post-MVP — engine code is already isolated in Docker, which is the higher-risk surface.
