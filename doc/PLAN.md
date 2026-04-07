# PLAN.md — Implementation Plan (TDD)

Every phase: **write tests for business logic → implement → tests pass → next phase.**
Skip boilerplate CRUD/validation tests — Zod and the framework handle those.

---

## Phase 1: Project Scaffold

### 1.1 Monorepo + DB

**Tasks:**
- [ ] pnpm workspace (cli, server, ui, packages/*)
- [ ] TypeScript strict, Biome, Vitest configs
- [ ] Docker Compose with PostgreSQL 17
- [ ] Drizzle schema for all tables (desks, experiments, runs, run_logs, datasets, comments, agent_sessions, memory_summaries, strategy_catalog)
- [ ] Shared Zod schemas in `packages/shared/` (including NormalizedResult, TradeEntry, PaperStatus)
- [ ] Seed script: `strategies/*.json` → `strategy_catalog` table

**Done when:** `pnpm install && pnpm typecheck && pnpm check && pnpm db:migrate` passes.

---

## Phase 2: Core API + UI Shell

### 2.1 Server + Routes

**Tasks:**
- [ ] Express server with routes per `doc/architecture/API.md`
- [ ] All endpoints: desks, experiments, runs, run_logs, comments, datasets, strategies, go-paper, stop, status
- [ ] Error handling middleware

**Tests (business logic only):**
```
- First run in an experiment automatically gets is_baseline=true
- Subsequent runs get is_baseline=false
- Experiment number auto-increments within a desk (create 3 → numbers are 1, 2, 3)
- Run delta calculation: run.result vs baseline.result produces correct return/drawdown/winrate diff
- GET /api/strategies?mode=classic&venues=binance returns only classic strategies whose engine matches the mode AND whose venue intersects the requested venues
- GET /api/strategies?mode=realtime&venues=interactive_brokers returns only realtime strategies
- POST /api/desks with strategy_mode=realtime on a venue that only supports classic → 400
- PATCH /api/desks/:id with strategy_mode or engine in body → 400 (immutable)
- POST /api/desks auto-derives engine from strategy_mode (classic→freqtrade, realtime→nautilus, generic fallback)
- Dataset with same exchange+pairs+timeframe+date_range can coexist (re-download = new record)
- POST /api/runs/:id/go-paper on a non-completed run → 400
- POST /api/runs/:id/go-paper on a desk with engine=generic → 400
- POST /api/runs/:id/stop on a non-paper run → 400
```

**Done when:** `pnpm test --filter=server` passes.

---

### 2.2 UI Shell

**Tasks:**
- [ ] React + Vite + Tailwind + Radix UI
- [ ] 3-column layout + Props panel (col1: desk list, col2: desk panel, col3: experiment detail + props)
- [ ] Desk creation wizard (6 steps: Desk → Venue → **Strategy Mode** → Strategy → Config → Launch)
- [ ] Venue multi-select chips from `strategies/venues.json` with "+ Add" custom venue
- [ ] **Strategy mode step** (between Venue and Strategy): two cards `Classic` (recommended) and `Real-time` (advanced). Cards are disabled/enabled based on `availableModes(selectedVenues)` — if selected venues only support `classic`, the `realtime` card is disabled with a tooltip, and vice versa. Never mention engine names.
- [ ] Strategy catalog browser filtered by selected venues **and strategy mode**, with category/difficulty filters
- [ ] ExperimentList + Paper list in col2
- [ ] RunTable in props panel (top section) with baseline delta display
- [ ] CommentThread (scrollable bottom in col3) with role tags
- [ ] Props panel: experiment props when no run selected, run metrics + [Start Paper Trading] button when run selected

**Tests:**
```
- Wizard creates desk with venues + first experiment + system comment (triggers agent) in single flow
- RunTable correctly shows "—" for baseline delta, computed delta for other rows
- CommentThread renders [user], [analyst], [risk_manager] tags from author field
- Default: most recent experiment auto-selected when desk is clicked
- Props panel shows [Start Paper Trading] button only for completed backtest runs
- Clicking [Start Paper Trading] → POST /api/runs/:id/go-paper
```

**Done when:** Full UI renders with API data, desk creation wizard works end-to-end.

---

## Phase 3: Workspace + Engine (parallelizable)

### 3.1 Workspace Management

**Tasks:**
- [ ] Workspace service: `initWorkspace(deskId, engine)` → creates dir with git init + engine-appropriate template files
- [ ] `commitCode(deskId, message)` → git commit, returns hash
- [ ] `getCode(deskId, commitHash)` → file contents at commit
- [ ] `getDiff(deskId, hash1, hash2)` → diff
- [ ] Hook into desk creation: auto-init workspace

**Tests:**
```
- commitCode after modifying strategy file → returns valid 40-char hash
- getCode with that hash → returns exact content that was committed
- getDiff between two commits → shows only the changed lines
- Two desks get isolated workspaces (changes in one don't appear in other)
- initWorkspace with engine=freqtrade → creates strategy.py + config.json
- initWorkspace with engine=nautilus → creates strategy.py + runner.py + config.py
- initWorkspace with engine=generic → creates empty workspace with README
```

**Done when:** `pnpm test --filter=server -- workspace` passes.

---

### 3.2 Engine Adapters (Docker-based)

Two managed engines (Freqtrade + Nautilus) plus Generic fallback. Hummingbot is **out of scope**. All engine processes run inside Docker containers using **pinned official images**. The server itself stays on the host. See `doc/architecture/ENGINE_ADAPTER.md` and `CLAUDE.md` rules 6–12.

**Tasks:**
- [ ] `packages/engines/src/images.ts` — pinned image tag constants (e.g. `freqtradeorg/freqtrade:2025.3`, `nautilustrader/nautilus_trader:1.220.0`)
- [ ] `packages/engines/src/docker.ts` — small Docker helper (run, exec, ps, logs, labels, events)
- [ ] `packages/engines/src/resolver.ts` — `resolveEngine(venue, mode) → engine` based on `MODE_TO_ENGINE = { classic: "freqtrade", realtime: "nautilus" }`; `availableModes(venue)` for wizard gating
- [ ] `packages/engines/freqtrade/` — FreqtradeAdapter
  - [ ] `ensureImage()` (docker pull pinned tag)
  - [ ] `downloadData()` ephemeral container with workspace mount
  - [ ] `runBacktest()` ephemeral container, parses freqtrade JSON output
  - [ ] `startPaper()` long-lived container with `dry_run: true`, REST API enabled, container labeled `quantdesk.runId / quantdesk.engine=freqtrade / quantdesk.kind=paper`
  - [ ] `getPaperStatus()` REST GET `/api/v1/status` + `/profit`
  - [ ] `stopPaper()` REST POST `/api/v1/stop` → SIGTERM fallback
  - [ ] `parseResult()` from JSON fixture
- [ ] `packages/engines/nautilus/` — NautilusAdapter
  - [ ] `ensureImage()`, `downloadData()`, `runBacktest()`, `parseResult()`
  - [ ] Ship `runner.py` that builds `TradingNode` with `SandboxExecutionClient` and emits `MessageBus` events as stdout JSONL
  - [ ] `startPaper()` long-lived container running `runner.py`, labeled `quantdesk.engine=nautilus`
  - [ ] `getPaperStatus()` reads container stdout JSONL stream
  - [ ] `stopPaper()` SIGTERM
- [ ] `packages/engines/generic/` — GenericAdapter (agent-written scripts, **backtest only**)
  - [ ] `ensureImage()` pulls a generic python+node base image
  - [ ] `downloadData()`, `runBacktest()` ephemeral container
  - [ ] `startPaper()`, `stopPaper()`, `getPaperStatus()` all throw `"generic engine does not support paper trading"`
- [ ] Engine registry: `getAdapter(engine) → EngineAdapter`
- [ ] Remove existing Hummingbot adapter directory/files

**Tests:**
```
Per-engine parse tests (offline, fixture-based):
- Freqtrade: parseResult with real freqtrade JSON fixture → correct NormalizedResult + TradeEntry[]
- Nautilus: stdout JSONL parser with fixture from runner.py output
- Generic: runBacktest stdout JSON parser
- Each: parseResult with error output → throws with meaningful message

Engine resolver tests:
- resolveEngine(binance, "classic") → "freqtrade"
- resolveEngine(binance, "realtime") → "nautilus"
- resolveEngine(bitvavo, "classic") → "freqtrade"
- resolveEngine(bitvavo, "realtime") → throws (bitvavo not in nautilus)
- resolveEngine(interactive_brokers, "realtime") → "nautilus"
- resolveEngine(interactive_brokers, "classic") → throws
- resolveEngine(kalshi, any) → "generic"
- availableModes(binance) → ["classic", "realtime"]
- availableModes(bitvavo) → ["classic"]
- availableModes(interactive_brokers) → ["realtime"]

Generic engine paper guard:
- generic.startPaper() → throws "does not support paper trading"

Adapter integration tests (skippable in CI, requires Docker daemon):
- ensureImage() pulls pinned tag
- runBacktest with a known strategy in container produces non-empty result
- startPaper container is launched with quantdesk.runId label
```

**Done when:** `pnpm test --filter=engines-*` passes (offline tests). Integration tests are skippable.

---

## Phase 4: AI Agent Adapter (parallelizable with Phase 3)

### 4.1 Claude + Codex CLI Adapters

**Tasks:**
- [ ] `packages/adapters/claude/` — spawn `claude --print - --output-format stream-json --verbose`
- [ ] `packages/adapters/codex/` — spawn `codex exec --json`
- [ ] Common interface: `spawnAgent(prompt, sessionId?) → { sessionId, usage, resultText }`
- [ ] Stream output parsing (Claude: stream-json, Codex: JSONL)
- [ ] Session resume: Claude uses `--resume {sessionId}`, Codex uses `resume {threadId} -`
- [ ] Adapter registry: `getAdapter(type)` returns correct adapter

**Tests:**
```
- parseOutputStream with Claude stream-json fixture → extracts sessionId, usage.tokens, resultText
- parseOutputStream with Codex JSONL fixture → extracts threadId, usage, summary
- Claude: sessionId provided → --resume flag in spawn args
- Codex: threadId provided → resume {threadId} in spawn args
- sessionId is null → fresh session (no resume flag)
- Adapter registry returns correct adapter for "claude" and "codex"
```

**Done when:** `pnpm test --filter=adapters` passes (mocked subprocess).

---

## Phase 5: Agent Pipeline (depends on Phase 2, 3, 4)

### 5.1 Prompt Builder

**Tasks:**
- [ ] `server/src/services/prompt-builder.ts`
- [ ] Analyst + Risk Manager prompt templates
- [ ] Context assembly: desk config + experiment + runs + comments + memory
- [ ] Token budget enforcement

**Tests:**
```
- Prompt includes desk budget/target/stop-loss values
- Prompt includes "You are working on Experiment #N — {title}"
- Prompt includes last 3 run results as structured data
- With 100 comments, prompt only includes last N that fit within token budget
- When memory_summaries exist (desk level), they appear before raw comments
- Prompt includes desk.strategy_mode and desk.engine (both immutable)
- When strategy_mode=classic, prompt instructs agent to write Freqtrade IStrategy subclasses (populate_indicators/populate_entry_trend/populate_exit_trend)
- When strategy_mode=realtime, prompt instructs agent to write Nautilus Strategy subclasses with event handlers (on_quote_tick, on_order_book_delta, on_order_filled)
- When engine=generic, prompt instructs agent to write backtest-only scripts and forbids proposing [PROPOSE_GO_PAPER]
- Risk Manager prompt includes run result + desk constraints
```

**Done when:** `pnpm test --filter=server -- prompt` passes.

---

### 5.2 Agent Runner

**Tasks:**
- [ ] `server/src/services/agent-runner.ts`
- [ ] Comment trigger → prompt build → adapter spawn → output parse → store results
- [ ] Run creation from backtest output (with run_logs from TradeEntry[])
- [ ] Workspace commit linking (code change → commit → run.commit_hash)
- [ ] Session persistence in agent_sessions (desk-level)

**Tests:**
```
- User comment → agent spawned with prompt including that comment
- Agent backtest result → Run created with parsed metrics + run_logs populated with trades
- Agent code change → workspace commit, run.commit_hash set
- Second comment on same desk → --resume with previous sessionId
- Agent error → comment with error, run.status=failed
- Agent on experiment #2 → session reused from experiment #1 (same desk)
```

**Done when:** `pnpm test --filter=server -- agent-runner` passes (mocked adapter).

---

### 5.3 Agent Triggers

**Tasks:**
- [ ] Proposal marker detection: `[PROPOSE_VALIDATION]`, `[PROPOSE_NEW_EXPERIMENT]`, `[PROPOSE_COMPLETE_EXPERIMENT]`, `[PROPOSE_GO_PAPER]`
- [ ] Button UI for approval (Approve / Decline)
- [ ] Risk Manager / new experiment / complete experiment / go-paper execution on approval

**Tests:**
```
- Agent output with [PROPOSE_VALIDATION] → proposal UI shown to user
- User clicks approve → Risk Manager spawned
- User clicks decline → no action
- Agent output with [PROPOSE_NEW_EXPERIMENT] My Title → proposal UI shown
- User approves → experiment created with title "My Title", number auto-incremented
- Agent output with [PROPOSE_COMPLETE_EXPERIMENT] → proposal UI shown
- User approves → experiment status set to "completed", experiment summary generated
- Agent output with [PROPOSE_GO_PAPER] <runId> → proposal UI shown
- User approves → POST /api/runs/:id/go-paper triggered
- Start paper trading without Risk Manager validation → warning shown, user can still proceed
```

**Done when:** `pnpm test --filter=server -- triggers` passes.

---

## Phase 6: WebSocket

**Tasks:**
- [ ] WebSocket server at `/api/experiments/:id/events/ws`
- [ ] Broadcast events: `run.status`, `run.paper`, `comment.new`
- [ ] UI: LiveUpdatesProvider + auto-refresh components

**Tests:**
```
- Client on experiment A receives events for A only
- run.status event received within 1s of status change
- run.paper event broadcasts live PnL/position updates
- comment.new contains full comment data
- UI RunTable and CommentThread auto-update on events
```

**Done when:** `pnpm test --filter=server -- websocket` passes, UI updates live.

---

## Phase 6.5: Paper Trading Pipeline

Common infrastructure that connects the Docker-based engine adapters (Phase 3.2) to long-lived paper trading sessions, with restart recovery via Docker labels. Engine-specific work lives in Phase 3.2; this phase is engine-agnostic plumbing.

**Tasks:**
- [ ] `server/src/services/paper-registry.ts` — `PaperProcessRegistry` (in-memory `Map<runId, PaperHandle>`, source of truth is Docker)
- [ ] `server/src/services/paper-reconcile.ts` — on server startup, `docker ps --filter label=quantdesk.kind=paper` → rebuild registry from labels. Containers that vanished while server was down → mark run `interrupted`
- [ ] Docker events listener — subscribe to container `die`/`destroy` events filtered by `quantdesk.kind=paper` → mark corresponding run `failed` or `interrupted`
- [ ] `server/src/services/paper-poller.ts` — 5-second poller that calls `adapter.getPaperStatus()` for every handle, appends to `run_logs` (`type=pnl`), and broadcasts `run.paper` WS events
- [ ] `services/runs.ts` `goPaper()` rewrite:
  - resolve `desk.engine` and adapter
  - check out `run.commitHash` into a runs subdirectory of the workspace
  - call `adapter.startPaper({ workspacePath, strategyPath, wallet: desk.budget })`
  - register handle, insert paper run row with `mode=paper, status=running`
  - guard: throw if `desk.engine === "generic"`
- [ ] `services/runs.ts` `stopRun()` rewrite:
  - look up handle in registry
  - call `adapter.stopPaper(handle)` (graceful → SIGTERM fallback)
  - update DB to `status=stopped`, broadcast WS
- [ ] `Run.status` enum migration: add `interrupted`
- [ ] `Desk.strategy_mode` and `Desk.engine` immutability: `services/desks.ts` `updateDesk()` rejects both fields; type `UpdateDeskInput` excludes them
- [ ] `run.paper` WebSocket event schema in `packages/shared/` (runId, unrealizedPnl, realizedPnl, openPositions, uptime, ts)
- [ ] UI: `LiveUpdatesContext` subscribes to `run.paper`, props panel shows live PnL / open positions / uptime for selected paper run
- [ ] UI: simulation fidelity disclaimer badge on paper run details ("Simulated execution — fills may be optimistic")
- [ ] UI: [Start Paper Trading] button disabled (with tooltip) for desks where `engine=generic`

**Tests:**
```
PaperProcessRegistry:
- register/get/delete handle round-trip
- list returns all active handles

paper-reconcile:
- with two labeled containers running → registry rebuilt with both handles
- with a labeled run in DB but no container → run marked `interrupted`
- with a container but no DB row → container left alone, logged as orphan

paper-poller:
- mock adapter returns status → run_logs row inserted, WS event broadcast
- mock adapter throws → poller continues for other handles, error logged
- handle removed mid-loop → no crash

goPaper:
- generic engine → throws "does not support paper trading"
- non-completed run → 400
- success path → adapter.startPaper called, registry has handle, DB row inserted
- workspace checked out at run.commitHash before startPaper

stopRun:
- handle exists → adapter.stopPaper called, registry cleared, DB updated
- non-paper run → 400

Desk.engine immutability:
- updateDesk({ engine: "freqtrade" }) on existing desk → rejected
- type UpdateDeskInput does not contain engine field (compile-time)

WS event:
- run.paper event broadcast contains correct shape and reaches subscribed clients only
```

**Done when:** `pnpm test --filter=server -- paper` passes; UI shows live paper trading metrics; restart-then-reconcile scenario verified manually with Docker.

---

## Phase 7: Memory Compaction

**Tasks:**
- [ ] Token counter utility
- [ ] Dynamic N selection in prompt builder
- [ ] Experiment summary generation on completion
- [ ] Desk summary generation (chained after experiment summary)
- [ ] Follow hipocampus compaction patterns

**Tests:**
```
- 100 comments in active experiment → prompt loads last N within budget
- Experiment completed → memory_summaries record (level=experiment)
- Summary contains: strategy changes, best/worst run metrics, key decisions
- After experiment summary → desk summary updated (level=desk)
- desk summary under 3K tokens with 10+ experiments
- Re-completing experiment → summary upserted, not duplicated
```

**Done when:** `pnpm test --filter=server -- memory` passes.

---

## Phase 8: CLI

**Tasks:**
- [ ] `npx quantdesk onboard --yes` — config, DB setup (Docker first, PGlite fallback), migration, seed
- [ ] `npx quantdesk start` — launch server + serve UI

**Tests:**
```
- onboard --yes with Docker available → uses Docker PostgreSQL
- onboard --yes without Docker → falls back to embedded PGlite
- onboard runs migrations and seeds strategy catalog
- start launches server, UI accessible at configured port
```

**Done when:** `npx quantdesk onboard --yes && npx quantdesk start` opens working app.

---

## Phase 9: E2E Integration

**Tests (full flow with mocked AI adapter):**
```
- Create desk "BTC ADX" via wizard → desk + experiment #1 created, workspace initialized
- Post "Run baseline BTC/USDT 5m" → data downloaded, backtest run
  → dataset created, run #1 (is_baseline=true), run_logs populated with trades
  → result comment posted with metrics
- Post "Add RSI filter p=21" → strategy.py modified, committed
  → run #2 (is_baseline=false), delta vs run #1 correct
- Post "validate" → Risk Manager spawned, validation comment posted
- Agent proposes [PROPOSE_NEW_EXPERIMENT] → user approves → experiment #2 created
  → session persists across experiments
- Complete experiment #1 → memory summary generated
- In experiment #2, prompt includes experiment #1 summary
- Click [Start Paper Trading] on run #2 → paper run created (mode=paper), run_logs stream pnl events
- Click Stop → paper run stopped
```

**Done when:** `pnpm test:e2e` passes.

---

## Phase 10: Docker Sandbox for Agent Execution

Currently the agent runs code directly on the host machine (`--dangerously-skip-permissions`), requiring Python, pip, and libraries to be pre-installed. This phase isolates agent execution inside a Docker container.

**Tasks:**
- [ ] Base Docker image with Python 3.12, Node 20, common libraries (pandas, numpy, ta, ccxt, tqdm)
- [ ] `quantdesk/sandbox` Dockerfile in `docker/sandbox/`
- [ ] Agent execution spawns inside container with workspace mounted as volume
- [ ] Network isolation: container can fetch market data (outbound HTTP) but no host access
- [ ] Timeout + resource limits (CPU, memory) per container
- [ ] Auto-pull/build sandbox image on first run if not present
- [ ] Fallback: if Docker is not available, warn and run on host (current behavior)

**Done when:** Agent writes + executes Python backtest inside container, results flow back to UI. Host machine only needs Docker installed.

---

## Dependency Graph

```
Phase 1 (scaffold)
  |
  v
Phase 2 (API + UI)
  |
  +-------+-------+
  v       v       v
Phase 3  Phase 4  (parallel)
(workspace (AI adapter)
 + engine)
  |       |
  +---+---+
      v
  Phase 5 (agent pipeline)
      |
  +---+---+
  v       v
Phase 6  Phase 7  (parallel)
(WS)    (memory)
  |       |
  +---+---+
      v
Phase 6.5 (paper pipeline)
      |
      v
  Phase 8 (CLI)
      |
      v
  Phase 9 (E2E)
      |
      v
  Phase 10 (Docker sandbox)
```
