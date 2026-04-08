# Plans

The single place where gaps between `doc/` (the spec) and the current code are
tracked. Per rule #14 in `CLAUDE.md`, `doc/plans/` is the **only** directory
allowed to use hedging language ("TODO", "not yet", "planned"). Everything in
the rest of `doc/` is written in the present tense as if already implemented.

## Categories

- **DONE** — spec item implemented and matches `doc/`. Listed in this README so
  future phases don't redo finished work.
- **TODO** — in `doc/`, missing or partial in code. Tracked as a phase file,
  fixed in code.
- **BUG** — exists in code but not in `doc/` (or contradicts it). Default
  action: fix the code, not the doc, unless the user explicitly approves a spec
  change.

Each phase is one PR-sized slice and follows TDD: failing tests first, then
implement until green, then refactor. A phase is only "done" when its tests
live in `pnpm test` and pass.

## Phases

| # | Title | Kind |
|---|-------|------|
| 01 | [Paper sessions: schema](01_paper_schema.md) | TODO |
| 02 | [Paper sessions: promotion gate](02_paper_promotion_gate.md) | TODO |
| 03 | [Paper sessions: container launch](03_paper_container_launch.md) | TODO |
| 04 | [Paper sessions: boot-time reconcile](04_paper_reconcile.md) | TODO |
| 05 | [Paper sessions: status polling](05_paper_status_polling.md) | TODO |
| 06 | [Paper sessions: observer turns](06_paper_observer_turns.md) | TODO |
| 07 | [Paper sessions: UI wiring](07_paper_ui.md) | TODO |
| 08 | [Risk Manager: session model](08_risk_manager_session.md) | TODO |
| 09 | [Risk Manager: dispatch on PROPOSE_VALIDATION](09_risk_manager_dispatch.md) | TODO |
| 10 | [Risk Manager: verdict loop-back](10_risk_manager_verdict.md) | TODO |
| 11 | [Memory compaction: trigger + budget](11_memory_trigger.md) | TODO |
| 12 | [Memory compaction: summarization](12_memory_summarization.md) | TODO |
| 13 | [Memory compaction: secret scrubbing](13_memory_scrubbing.md) | TODO |
| 14 | [Memory compaction: prompt injection](14_memory_injection.md) | TODO |
| 15 | [Generic paper: startPaper](15_generic_start_paper.md) | BUG |
| 16 | [Generic paper: stopPaper + getPaperStatus](16_generic_stop_status.md) | BUG |
| 17 | [Image whitelist: ensureImage guard](17_image_ensure_guard.md) | TODO |
| 18 | [Image whitelist: registry guard](18_image_registry_guard.md) | TODO |
| 19 | [Generic engine: downloadData via agent-authored fetcher](19_generic_download_data.md) | TODO |

## DONE (baseline — already in code)

Verified against the spec docs and the current tree.

- Agent turn execution and CLI subprocess flow — `server/src/services/agent-trigger.ts`
- Session resume via persisted `sessionId` — `agentSessions` table
- All nine markers parsed and stripped before persistence —
  `packages/shared/src/agent-markers.ts`, `server/src/services/triggers.ts`
- Stage 1 first-run gate: agent must emit `[PROPOSE_DATA_FETCH]` and stop —
  `server/src/services/prompt-builder.ts`
- Global dataset cache + per-desk symlinks + incremental fetch —
  `server/src/services/data-fetch.ts`, `~/.quantdesk/datacache/`
- `datasets` ↔ `desk_datasets` M:N schema
- Per-desk git workspace, commit-per-turn, `commit_hash` on `runs` —
  `server/src/services/workspace.ts`
- Strategy mode + engine immutability enforced on update —
  `server/src/routes/desks.ts`
- Three engine adapters registered with pinned image tags (no `:latest`) —
  Freqtrade `2026.3`, Nautilus `sha256:…`, Generic — `packages/engines/src/images.ts`
- `EngineAdapter` interface fully implemented for Freqtrade and Nautilus
  (`ensureImage`, `downloadData`, `runBacktest`, `startPaper`, `stopPaper`,
  `getPaperStatus`, `parseResult`)
- Container resource limits via `--cpus` / `--memory`
- Paper container labels emitted by Freqtrade adapter:
  `quantdesk.runId`, `quantdesk.engine`, `quantdesk.kind=paper` —
  `packages/engines/src/freqtrade/adapter.ts`
- `memory_summaries` table exists and is read by the prompt builder
- Risk Manager **role infrastructure** (not dispatch): `agent_sessions.agentRole`, `buildRiskManagerPrompt`, `agent-runner.ts` branches by role. Dispatch wiring is still missing — see phase 09.

## Open questions

- Observer cadence for phase 06 (fixed interval vs. event-driven only).
- Whether the risk-manager session in phase 08 reuses the analyst's CLI
  subprocess or spawns a fresh one with its own `sessionId`.
