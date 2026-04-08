# Plans

The single place where gaps between `doc/` (the spec) and the current code are
tracked. Per CLAUDE.md rule #14, `doc/plans/` is the **only** directory allowed
to use hedging language ("TODO", "not yet", "planned"). Everything else in
`doc/` is written in the present tense.

## Categories

- **DONE** — implemented and matches spec. Listed in this README so future phases don't redo finished work.
- **TODO** — in spec, missing or partial in code. Tracked as a phase file.
- **BUG** — exists in code but contradicts spec. Default action: fix the code, not the doc.

Each phase is one PR-sized slice and follows TDD: failing tests first, then implement until green, then refactor. A phase is only "done" when its tests live in `pnpm test` and pass.

## Phases (in execution order)

### Group A — Test harness foundation

The harness verifies CLAUDE.md rule #15 (no user dead-ends) for every existing and future code path. Build it first against the one path that already works (`PROPOSE_DATA_FETCH`), then expand as later phases land.

| # | Title | Kind |
|---|-------|------|
| 01 | [Static lint: actionable system comments](01_dead_end_lint.md) | TODO |
| 02 | [Dispatch invariant: hasNextAction afterEach](02_dispatch_invariant.md) | TODO |
| 03 | [Spec-generated test matrix from MARKERS.md](03_spec_generated_matrix.md) | TODO |

### Group B — Wire the remaining markers

Four `PROPOSE_*` markers and `RUN_PAPER` are parsed today but have **no dispatcher branch**. The UI may render Approve buttons that go nowhere — direct rule #15 violation. Each phase here adds one dispatcher and is guarded by Group A.

| # | Title | Kind |
|---|-------|------|
| 04 | [Generic /comments/:id/approve dispatcher](04_approve_router.md) | TODO |
| 05 | [PROPOSE_NEW_EXPERIMENT approve handler](05_propose_new_experiment.md) | TODO |
| 06 | [PROPOSE_COMPLETE_EXPERIMENT approve handler](06_propose_complete_experiment.md) | TODO |
| 07 | [PROPOSE_VALIDATION → Risk Manager dispatch](07_risk_manager_dispatch.md) | TODO |
| 08 | [Risk Manager verdict loop-back](08_risk_manager_verdict.md) | TODO |

### Group B½ — Workspace bootstrap (priority over Group C)

Lets users seed a desk from existing local code and bind-mount existing local datasets at container start. Quants almost always have something local already; the current "describe in natural language" loop is the largest onboarding friction. Slot before paper trading.

| # | Title | Kind |
|---|-------|------|
| 25 | [Workspace bootstrap: seed code copy at desk creation](25_workspace_bootstrap_code.md) | TODO |
| 26 | [External dataset bind mounts](26_external_dataset_mounts.md) | TODO |

### Group C — Paper trading lifecycle

| # | Title | Kind |
|---|-------|------|
| 09 | [paperSessions table schema](09_paper_schema.md) | TODO |
| 10 | [paper-sessions service: promotion gates](10_paper_gates.md) | TODO |
| 11 | [RUN_PAPER + PROPOSE_GO_PAPER dispatch](11_paper_dispatch.md) | TODO |
| 12 | [Boot-time paper reconcile](12_paper_reconcile.md) | TODO |
| 13 | [Paper status polling](13_paper_status_polling.md) | TODO |
| 14 | [Observer turns while paper runs](14_paper_observer_turns.md) | TODO |
| 15 | [Paper UI wiring + desk header widget](15_paper_ui.md) | TODO |

### Group D — BUG fixes (code violates spec)

| # | Title | Kind |
|---|-------|------|
| 16 | [Generic downloadData must run inside container](16_generic_download_in_container.md) | BUG |
| 17 | [Generic startPaper / stopPaper / getPaperStatus](17_generic_paper.md) | BUG |
| 18 | [Image whitelist: ensureImage runtime guard](18_image_ensure_guard.md) | TODO |
| 19 | [Image whitelist: registry constructor guard](19_image_registry_guard.md) | TODO |

### Group E — Memory compaction

| # | Title | Kind |
|---|-------|------|
| 20 | [Memory compaction trigger + token budget](20_memory_trigger.md) | TODO |
| 21 | [LLM summarization into memory_summaries](21_memory_summarization.md) | TODO |
| 22 | [Secret scrubbing on the way in](22_memory_scrubbing.md) | TODO |
| 23 | [Prompt injection ordering + budget guard](23_memory_injection.md) | TODO |

### Group F — UX

| # | Title | Kind |
|---|-------|------|
| 24 | [Server-side P1 bootstrap for catalog desks](24_catalog_p1_bootstrap.md) | TODO |

## DONE (baseline — already in code)

Verified against the spec docs and the current tree.

### Marker dispatch
- `RUN_BACKTEST` — full dispatch (parser, engine spawn, runs row insert, retrigger). Refusal branch posts a rule #13 system comment naming `[PROPOSE_DATA_FETCH]`. — `server/src/services/agent-trigger.ts`
- `PROPOSE_DATA_FETCH` — full dispatch (parser, `pendingProposal` attach, `/data-fetch` approval route, cache lookup or `executeDataFetch` container, `desk_datasets` link, retrigger). — `server/src/services/{triggers,data-fetch}.ts`, `server/src/routes/experiments.ts`
- `EXPERIMENT_TITLE` — parser + experiment row update, no retrigger (metadata-only). — `server/src/services/agent-trigger.ts`
- `stripAgentMarkers` — every marker stripped before persistence. — `packages/shared/src/agent-markers.ts`

### Lifecycle infrastructure
- `triggerAgent(experimentId)` single entry point, CLI subprocess (claude / codex adapters), session resume via persisted `sessionId`. — `server/src/services/agent-trigger.ts`, `packages/adapters/`
- Stage 1 first-run gate: agent prompted to emit `[PROPOSE_DATA_FETCH]` first when no dataset; `RUN_BACKTEST` early-returns with rule #13 refusal otherwise. — `server/src/services/{prompt-builder,agent-trigger}.ts`
- Per-desk git workspace, commit-per-turn, `commit_hash` on `runs` rows. — `server/src/services/workspace.ts`

### Risk Manager *infrastructure* (dispatch still missing — see phase 07)
- `agent_sessions.agentRole` column (`analyst | risk_manager`). — `packages/db/src/schema.ts`
- `buildRiskManagerPrompt()` template. — `server/src/services/prompt-builder.ts`
- `agent-runner.ts` branches its prompt by role.

### Datasets and storage
- Global dataset cache at `~/.quantdesk/datacache/`, per-desk symlinks, incremental fetch (full hit / partial hit / miss). — `server/src/services/data-fetch.ts`
- `datasets` ↔ `desk_datasets` M:N schema. — `packages/db/src/schema.ts`

### Engines
- Three adapters registered: Freqtrade, Nautilus, Generic. — `packages/engines/src/registry.ts`
- Pinned image references (no `:latest`): `freqtradeorg/freqtrade:2026.3`, Nautilus by digest. — `packages/engines/src/images.ts`
- `EngineAdapter` interface: `name`, `ensureImage`, `downloadData`, `runBacktest`, `startPaper`, `stopPaper`, `getPaperStatus`, `parseResult`. — `packages/engines/src/types.ts`
- Container resource limits via `--cpus` / `--memory`.
- Freqtrade adapter implements **all** methods including paper container labels (`quantdesk.runId` / `quantdesk.engine` / `quantdesk.kind=paper`). — `packages/engines/src/freqtrade/adapter.ts`

### Strategy mode
- `strategy_mode` + `engine` are immutable per desk, enforced on update. — `server/src/routes/desks.ts`
- `(strategy_mode, venue) → engine` resolved via `resolveEngine()`; `generic` is the fallback engine, never a `strategy_mode`. — `packages/engines/src/registry.ts`

### Memory infrastructure (population still missing — see phase 21)
- `memory_summaries` table with `level` / `experimentId` / `content`. — `packages/db/src/schema.ts`
- Prompt builder reads desk-level + experiment-level summaries. — `server/src/services/prompt-builder.ts`

## Open questions

- Observer-turn cadence in phase 14 (fixed interval vs. event-driven only).
- Whether the risk-manager session in phase 07 reuses the analyst's CLI subprocess or spawns a fresh one with its own `sessionId`.
- Whether Group A (test harness) lands in this order or interleaves with Group B as the second path it can lint.
