# Plans

The single place where gaps between `doc/` (the spec) and the current code are
tracked. Per CLAUDE.md rule #11, `doc/plans/` is the **only** directory allowed
to use hedging language ("TODO", "not yet", "planned"). Everything else in
`doc/` is written in the present tense.

## Categories

- **DONE** — implemented and matches spec. Listed in this README so future phases don't redo finished work.
- **TODO** — in spec, missing or partial in code. Tracked as a phase file.
- **BUG** — exists in code but contradicts spec. Default action: fix the code, not the doc.

Each phase is one PR-sized slice and follows TDD: failing tests first, then implement until green, then refactor. A phase is only "done" when its tests live in `pnpm test` and pass.

## Phases (in execution order)

### Group D — Paper trading lifecycle

| # | Title | Kind |
|---|-------|------|
| 11 | [paperSessions table schema](11_paper_schema.md) | TODO |
| 12 | [paper-sessions service: promotion gates](12_paper_gates.md) | TODO |
| 13 | [Paper trading MCP tools (go_paper / run_paper)](13_paper_dispatch.md) | TODO |
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

### Agent protocol (phase 27)
- **MCP tool migration** — the bracketed-marker protocol (`[DATA_FETCH]`, `[RUN_BACKTEST]`, etc.) is gone. Every lifecycle action (data_fetch, register_dataset, run_backtest, set_experiment_title, request_validation, submit_rm_verdict, new_experiment, complete_experiment) is now an MCP tool hosted in-process at `POST /mcp` on the parent server. Claude CLI connects via `--mcp-config` → `{"type":"http","url":"http://127.0.0.1:PORT/mcp","headers":{"X-QuantDesk-Experiment":..., "X-QuantDesk-Desk":...}}`. Tool handlers run in-process with full access to the DB, event emitter, engine adapters, and `triggerAgent`. Dead-end guard's hadMarker signal is now driven by `tool_call` streaming chunks instead of marker regex. See `doc/agent/MCP.md`. — `server/src/mcp/{server,http-route}.ts`, `server/src/services/{agent-trigger,prompts/analyst-system}.ts`, `packages/shared/src/agent-markers.ts` (reduced to defensive stripping).


Verified against the spec docs and the current tree.

### Lifecycle dispatch (phase 27 — MCP tools)
The bracketed-marker protocol (`[DATA_FETCH]` / `[RUN_BACKTEST]` / `[DATASET]` / `[EXPERIMENT_TITLE]` / `[VALIDATION]` / `[NEW_EXPERIMENT]` / `[COMPLETE_EXPERIMENT]` / `[RM_APPROVE]` / `[RM_REJECT]` / `[GO_PAPER]` / `[RUN_PAPER]`) and the proposal-handler router it fed have been deleted entirely. Dispatch lives in MCP tool handlers (`server/src/mcp/server.ts`), invoked by the agent during a turn via the HTTP bridge at `POST /mcp`. See `doc/agent/MCP.md` for the tool catalog. `stripAgentMarkers` remains as a defensive shim in `packages/shared/src/agent-markers.ts` so stray bracket text never leaks into persisted comments.

### Agent turns (phase 27)
- **`agent_turns` table** — one row per `triggerAgent` invocation, `runs.turn_id` and `comments.turn_id` FKs stamp via AsyncLocalStorage so call sites stay untouched. `triggerAgent` opens the row, bumps `last_heartbeat_at` on every stream chunk, and finalizes `status` (`completed` / `failed` / `stopped`) + `failure_reason` in a try/catch/finally. — `packages/db/src/schema.ts`, `server/src/services/{agent-trigger,turn-context,comments}.ts`
- **Boot reconcile + heartbeat watchdog** — orphan `running` rows left after a server restart are marked `failed` with `failure_reason='server_restart'` at boot; a 30s-tick watchdog catches silent subprocess deaths at runtime (90s heartbeat threshold) and posts a rule #12 system comment on the owning experiment. — `server/src/services/{startup-cleanup,turn-watchdog}.ts`
- **Read API + SSE** — `GET /api/turns/:id` returns the turn row + linked runs + comments; `GET /api/experiments/:id/turns` lists turns chronologically; `turn.status` events (running/completed/failed/stopped) publish on the existing experiment channel. — `server/src/{routes/turns,services/turns,realtime/live-events}.ts`
- **TurnCard UI** — `RunWidget` renamed to `TurnCard` with a `status` lifecycle prop; `CommentThread` keeps the card mounted after agent finishes so the user sees a clear terminal state instead of a vanishing widget. `/desks/:deskId/turns/:turnId` detail page for the TurnCard's "Open" button. Engine container stdout/stderr forwards through `BacktestConfig.onLogLine` → `run.log_chunk` SSE → live tail block inside the card. — `ui/src/components/{TurnCard,CommentThread}.tsx`, `ui/src/pages/TurnDetailPage.tsx`, `packages/engines/src/{types,freqtrade/adapter}.ts`

### Lifecycle infrastructure
- `triggerAgent(experimentId)` single entry point, CLI subprocess (claude / codex adapters), session resume via persisted `sessionId`. — `server/src/services/agent-trigger.ts`, `packages/adapters/`
- Per-desk git workspace, commit-per-turn, `commit_hash` on `runs` rows. — `server/src/services/workspace.ts`
- **Resume prompt injects all new comments since the last analyst turn** — the `## New since your last turn` section tails everything posted after the last analyst comment (user + system), so server-side side-effect comments (`Downloaded …`, `Data-fetch failed …`, `Backtest Run #N failed …`) always reach the agent and it never resumes blind. — `server/src/services/prompt-builder.ts`, `doc/agent/TURN.md`

### Risk Manager
- `agent_sessions.agentRole` column (`analyst | risk_manager`). — `packages/db/src/schema.ts`
- `buildRiskManagerPrompt()` template. — `server/src/services/prompt-builder.ts`
- `agent-runner.ts` branches its prompt by role.
- `triggerAgent(experimentId, role)` accepts an optional role param (defaults to `"analyst"`); the new `getOrCreateAgentSession(deskId, role)` lazily creates the `risk_manager` row on first use, inheriting adapter config from the analyst session. — `server/src/services/agent-trigger.ts`
- **`request_validation` MCP tool** wakes the Risk Manager — the tool handler calls `triggerAgent(experimentId, "risk_manager")`. Requires prior user consent. — `server/src/mcp/server.ts`
- **RM verdict loop-back** — RM ends every turn by calling `mcp__quantdesk__submit_rm_verdict({verdict, reason?})`. The handler writes `result.validation = { verdict, reason, at }` onto the latest `runs` row and retriggers the analyst with the verdict in context. RM never retriggers itself. Paper trading tools gate on `result.validation.verdict === "approve"`. — `server/src/mcp/server.ts`

### Datasets and storage
- Global dataset cache at `~/.quantdesk/datacache/`, per-desk symlinks, incremental fetch (full hit / partial hit / miss). — `server/src/services/data-fetch.ts`
- `datasets` ↔ `desk_datasets` M:N schema. — `packages/db/src/schema.ts`
- **Workspace bootstrap (seed code)** — `createDesk` accepts an optional absolute `seedCodePath`. `validateSeedPath` rejects the home root, `/etc`, `/root`, `~/.ssh` / `~/.aws` / `~/.gnupg` / `~/.kube` / `~/.docker` / etc., and any directory whose recursive size (skipping `.git` / `node_modules` / build dirs) exceeds 50 MB. `bootstrapWorkspace` then copies the tree into `workspaces/desk-{id}/` (preserving structure) and the initial git commit message becomes `chore: seed from {basename}`. Wizard UI is a follow-up. — `server/src/services/{seed-path,workspace,desks}.ts`, `packages/shared/src/seed-path.ts`
- **External dataset bind mounts** — `createDesk` accepts an optional `externalMounts: { label, hostPath, description? }[]`. Each mount is validated against the same path deny-list as `seedCodePath`, plus a `[a-z0-9_-]+` label format check, plus per-desk uniqueness. Persisted on `desks.externalMounts` (jsonb, default `[]`). `BacktestConfig.extraVolumes` and `PaperConfig.extraVolumes` carry the resolved `-v hostPath:/workspace/data/external/<label>:ro` strings, which the Freqtrade and Nautilus adapters concat onto their workspace mount before calling `runContainer` / `runDetached`. Wizard UI is a follow-up. Migration `0005_lyrical_gauntlet.sql`. — `packages/db/src/schema.ts`, `packages/{shared,engines}/src/...`, `server/src/services/{seed-path,desks,agent-trigger}.ts`

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

### Rule #12 enforcement
- `systemComment(...)` wrapper is the only sanctioned way to insert a system-authored comment; every caller must declare `nextAction: "action" | "retrigger" | "progress"`. — `server/src/services/comments.ts`
- Static lint (`server/src/__tests__/no-dead-end-lint.test.ts`) rejects (a) any direct `createComment({ author: "system" })` outside the wrapper, and (b) any `nextAction: "action"` call whose literal content does not contain a phrase from `ACTION_PHRASE_PATTERNS`. Runs in `pnpm test`.
- Pure `hasNextAction(snapshot)` invariant checker — `server/src/services/has-next-action.ts`. Returns `{ ok, reason }` over a `DeskInvariantSnapshot` (pendingProposal count, latest system-comment content, retrigger queue state). The DB-touching `assertNoDeadEnd(deskId)` afterEach helper at `server/src/__tests__/helpers/no-dead-end-after-each.ts` wraps it for integration tests when those land.
- `doc/agent/MCP.md` is the authoritative dispatch contract. The live tool catalog lives in `server/src/mcp/server.ts`; the `mcp/__tests__/server.test.ts` smoke test asserts the factory registers every expected tool name.

## Open questions

- Observer-turn cadence in phase 16 (fixed interval vs. event-driven only).
- Whether the risk-manager session in phase 07 reuses the analyst's CLI subprocess or spawns a fresh one with its own `sessionId`.
- Whether Group A (test harness) lands in this order or interleaves with Group B as the second path it can lint.
