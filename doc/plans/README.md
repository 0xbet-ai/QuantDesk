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
| 02 | [Dispatch invariant: hasNextAction afterEach](02_dispatch_invariant.md) | TODO |
| 03 | [Spec-generated test matrix from MARKERS.md](03_spec_generated_matrix.md) | TODO |

### Group B — Wire the remaining markers

Four `PROPOSE_*` markers and `RUN_PAPER` are parsed today but have **no dispatcher branch**. The UI may render Approve buttons that go nowhere — direct rule #15 violation. Each phase here adds one dispatcher and is guarded by Group A.

| # | Title | Kind |
|---|-------|------|
| 05 | [PROPOSE_NEW_EXPERIMENT approve handler](05_propose_new_experiment.md) | TODO |
| 06 | [PROPOSE_COMPLETE_EXPERIMENT approve handler](06_propose_complete_experiment.md) | TODO |
| 07 | [PROPOSE_VALIDATION → Risk Manager dispatch](07_risk_manager_dispatch.md) | TODO |
| 08 | [Risk Manager verdict loop-back](08_risk_manager_verdict.md) | TODO |

### Group C — Workspace bootstrap

Lets users seed a desk from existing local code and bind-mount existing local datasets at container start. Quants almost always have something local already; the current "describe in natural language" loop is the largest onboarding friction. Slot before paper trading.

| # | Title | Kind |
|---|-------|------|
| 09 | [Workspace bootstrap: seed code copy at desk creation](09_workspace_bootstrap_code.md) | TODO |
| 10 | [External dataset bind mounts](10_external_dataset_mounts.md) | TODO |

### Group D — Paper trading lifecycle

| # | Title | Kind |
|---|-------|------|
| 11 | [paperSessions table schema](11_paper_schema.md) | TODO |
| 12 | [paper-sessions service: promotion gates](12_paper_gates.md) | TODO |
| 13 | [RUN_PAPER + PROPOSE_GO_PAPER dispatch](13_paper_dispatch.md) | TODO |
| 14 | [Boot-time paper reconcile](14_paper_reconcile.md) | TODO |
| 15 | [Paper status polling](15_paper_status_polling.md) | TODO |
| 16 | [Observer turns while paper runs](16_paper_observer_turns.md) | TODO |
| 17 | [Paper UI wiring + desk header widget](17_paper_ui.md) | TODO |

### Group E — BUG fixes (code violates spec)

| # | Title | Kind |
|---|-------|------|
| 18 | [Generic downloadData must run inside container](18_generic_download_in_container.md) | BUG |
| 19 | [Generic startPaper / stopPaper / getPaperStatus](19_generic_paper.md) | BUG |
| 20 | [Image whitelist: ensureImage runtime guard](20_image_ensure_guard.md) | TODO |
| 21 | [Image whitelist: registry constructor guard](21_image_registry_guard.md) | TODO |

### Group F — Memory compaction

| # | Title | Kind |
|---|-------|------|
| 22 | [Memory compaction trigger + token budget](22_memory_trigger.md) | TODO |
| 23 | [LLM summarization into memory_summaries](23_memory_summarization.md) | TODO |
| 24 | [Secret scrubbing on the way in](24_memory_scrubbing.md) | TODO |
| 25 | [Prompt injection ordering + budget guard](25_memory_injection.md) | TODO |

### Group G — UX

| # | Title | Kind |
|---|-------|------|
| 26 | [Server-side P1 bootstrap for catalog desks](26_catalog_p1_bootstrap.md) | TODO |

## DONE (baseline — already in code)

Verified against the spec docs and the current tree.

### Marker dispatch
- `RUN_BACKTEST` — full dispatch (parser, engine spawn, runs row insert, retrigger). Refusal branch posts a rule #13 system comment naming `[PROPOSE_DATA_FETCH]`. — `server/src/services/agent-trigger.ts`
- `PROPOSE_DATA_FETCH` — full dispatch (parser, `pendingProposal` attach, generic `/api/comments/:id/approve` route dispatches to the data-fetch handler, cache lookup or `executeDataFetch` container, `desk_datasets` link, retrigger). — `server/src/services/{triggers,data-fetch,proposal-handlers/data-fetch-handler}.ts`, `server/src/routes/comments.ts`
- `EXPERIMENT_TITLE` — parser + experiment row update, no retrigger (metadata-only). — `server/src/services/agent-trigger.ts`
- `stripAgentMarkers` — every marker stripped before persistence. — `packages/shared/src/agent-markers.ts`
- **Generic proposal approve/reject router** at `POST /api/comments/:commentId/{approve,reject}`, keyed off `comment.metadata.pendingProposal.type`. Handler registry in `server/src/services/proposal-handlers/registry.ts`. Phases 05-07 and 11 each register one handler behind the same router. UI calls `postProposalDecision(commentId, action)` — no per-type endpoints. — `server/src/routes/comments.ts`, `server/src/services/proposal-handlers/`

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

### Memory infrastructure (population still missing — see phase 23)
- `memory_summaries` table with `level` / `experimentId` / `content`. — `packages/db/src/schema.ts`
- Prompt builder reads desk-level + experiment-level summaries. — `server/src/services/prompt-builder.ts`

### Rule #15 enforcement
- `systemComment(...)` wrapper is the only sanctioned way to insert a system-authored comment; every caller must declare `nextAction: "action" | "retrigger" | "progress"`. — `server/src/services/comments.ts`
- Static lint (`server/src/__tests__/no-dead-end-lint.test.ts`) rejects (a) any direct `createComment({ author: "system" })` outside the wrapper, and (b) any `nextAction: "action"` call whose literal content does not contain a phrase from `ACTION_PHRASE_PATTERNS`. Runs in `pnpm test`.

## Open questions

- Observer-turn cadence in phase 16 (fixed interval vs. event-driven only).
- Whether the risk-manager session in phase 07 reuses the analyst's CLI subprocess or spawns a fresh one with its own `sessionId`.
- Whether Group A (test harness) lands in this order or interleaves with Group B as the second path it can lint.
