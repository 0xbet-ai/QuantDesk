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

### Group E — BUG fixes (code violates spec)

| # | Title | Kind |
|---|-------|------|
| 20 | [Image whitelist: ensureImage runtime guard](20_image_ensure_guard.md) | TODO |
| 21 | [Image whitelist: registry constructor guard](21_image_registry_guard.md) | TODO |

### Group F — Memory compaction

| # | Title | Kind |
|---|-------|------|
| 24 | [Secret scrubbing on the way in](24_memory_scrubbing.md) | TODO |

## DONE (baseline — already in code)

### Paper trading (phases 11, 12, 14, 15, 17)
- **Paper session schema** — `paperSessions` table with `deskId`, `runId`, `engine`, `containerName`, `status` lifecycle, `startedAt` / `stoppedAt` / `lastStatusAt`. Migration wired into the baseline drizzle set. — `packages/db/src/schema.ts`
- **Promotion gates** — `startPaper` / `stopPaper` / `getActiveSession` enforce the "one paper session per desk" invariant and the `runs.result.validation.verdict === "approve"` precondition, and drive the state transitions. All gating is in the service layer, not the route. — `server/src/services/paper-sessions.ts`
- **Boot-time reconcile** — `reconcilePaperSessions()` queries `docker ps --filter label=quantdesk.kind=paper` at startup, then for each stored row either keeps it running (live container still present), marks it `failed` with a rule #12 system comment (DB says running but container vanished during restart), or cleans up the orphan container (live container without a matching DB row). — `server/src/services/startup-cleanup.ts`
- **Paper UI + desk header widget** — `PaperTradingView` renders the live status block, stop button, and WebSocket status feed; the desk header surfaces the active paper widget so operators see the session without drilling in. — `ui/src/components/PaperTradingView.tsx`
- **Paper status polling (phase 15)** — superseded by market tick (5s `getPaperMarketTickLine` polling → `paper.log` WebSocket events) + container log streaming (`docker logs -f` → `paper.log`). Configurable via `paper.marketTickIntervalMs`. Boot reconcile re-attaches both. `PYTHONUNBUFFERED=1` on all containers for real-time stdout flush. See `15_paper_status_polling.md` for the full mapping from original spec to implementation.

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

### Memory infrastructure (phases 22, 23)
- `memory_summaries` table with `level` / `experimentId` / `content`. — `packages/db/src/schema.ts`
- **Rich experiment summaries (phase 23)** — `generateMemorySummary()` produces a structured knowledge brief on experiment completion: hypothesis, full run progression with metrics + RM verdicts, rejection reasons (verbatim, 200-char cap each), paper trading outcome, RM final assessment, analyst conclusion. Template-based (no LLM call); captures the learning signal that lets future experiments avoid repeating past failures. — `server/src/services/experiments.ts`
- **Token-budgeted prompt injection (phase 22)** — `## Context Summary` section in `buildAnalystPrompt()` enforces a 4000-token budget. Desk-level summaries always kept; experiment summaries kept newest-first until budget hit; older summaries dropped gracefully. Prevents unbounded prompt growth as experiments accumulate. — `server/src/services/prompt-builder.ts`

### Rule #12 enforcement
- `systemComment(...)` wrapper is the only sanctioned way to insert a system-authored comment; every caller must declare `nextAction: "action" | "retrigger" | "progress"`. — `server/src/services/comments.ts`
- Static lint (`server/src/__tests__/no-dead-end-lint.test.ts`) rejects (a) any direct `createComment({ author: "system" })` outside the wrapper, and (b) any `nextAction: "action"` call whose literal content does not contain a phrase from `ACTION_PHRASE_PATTERNS`. Runs in `pnpm test`.
- Pure `hasNextAction(snapshot)` invariant checker — `server/src/services/has-next-action.ts`. Returns `{ ok, reason }` over a `DeskInvariantSnapshot` (pendingProposal count, latest system-comment content, retrigger queue state). The DB-touching `assertNoDeadEnd(deskId)` afterEach helper at `server/src/__tests__/helpers/no-dead-end-after-each.ts` wraps it for integration tests when those land.
- `doc/agent/MCP.md` is the authoritative dispatch contract. The live tool catalog lives in `server/src/mcp/server.ts`; the `mcp/__tests__/server.test.ts` smoke test asserts the factory registers every expected tool name.

### Retired phases (removed from backlog)
- **Phase 13** (run_paper auto-restart) — deferred, not needed for current scope.
- **Phase 15** (paper status polling) — superseded by market tick + container log streaming.
- **Phase 16** (observer turns) — deferred, not needed for current scope.
- **Phase 18** (generic downloadData in container) — resolved: adapter throws with delegation message, agent uses `run_script`.
- **Phase 19** (generic paper trading) — same pattern as 18: adapter throws with delegation message, agent uses `run_script`.
- **Phase 22** (memory trigger) — implemented in `server/src/services/experiments.ts`.
- **Phase 23** (memory summarization) — implemented in `generateMemorySummary()`.
- **Phase 25** (prompt injection ordering + budget guard) — implemented in `prompt-builder.ts` with `MEMORY_TOKEN_BUDGET = 4000`.
