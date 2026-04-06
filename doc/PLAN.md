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
- [ ] Shared Zod schemas in `packages/shared/` (including NormalizedResult, TradeEntry, LiveStatus)
- [ ] Seed script: `strategies/*.json` → `strategy_catalog` table

**Done when:** `pnpm install && pnpm typecheck && pnpm check && pnpm db:migrate` passes.

---

## Phase 2: Core API + UI Shell

### 2.1 Server + Routes

**Tasks:**
- [ ] Express server with routes per `doc/architecture/API.md`
- [ ] All endpoints: desks, experiments, runs, run_logs, comments, datasets, strategies, go-live, stop, status
- [ ] Error handling middleware

**Tests (business logic only):**
```
- First run in an experiment automatically gets is_baseline=true
- Subsequent runs get is_baseline=false
- Experiment number auto-increments within a desk (create 3 → numbers are 1, 2, 3)
- Run delta calculation: run.result vs baseline.result produces correct return/drawdown/winrate diff
- GET /api/strategies?engine=freqtrade returns only freqtrade strategies from seeded catalog
- Dataset with same exchange+pairs+timeframe+date_range can coexist (re-download = new record)
- POST /api/runs/:id/go-live on a non-completed run → 400
- POST /api/runs/:id/stop on a non-live run → 400
```

**Done when:** `pnpm test --filter=server` passes.

---

### 2.2 UI Shell

**Tasks:**
- [ ] React + Vite + Tailwind + Radix UI
- [ ] 3-column layout + Props panel (col1: desk list, col2: desk panel, col3: experiment detail + props)
- [ ] Desk creation wizard (5 steps: Desk → Venue → Strategy → Config → Launch)
- [ ] Venue multi-select chips from `strategies/venues.json` with "+ Add" custom venue
- [ ] Strategy catalog browser filtered by selected venues, with category/difficulty filters
- [ ] ExperimentList + Live list in col2
- [ ] RunTable in props panel (top section) with baseline delta display
- [ ] CommentThread (scrollable bottom in col3) with role tags
- [ ] Props panel: experiment props when no run selected, run metrics + [Go Live] button when run selected

**Tests:**
```
- Wizard creates desk with venues + first experiment + system comment (triggers agent) in single flow
- RunTable correctly shows "—" for baseline delta, computed delta for other rows
- CommentThread renders [user], [analytics], [risk_manager] tags from author field
- Default: most recent experiment auto-selected when desk is clicked
- Props panel shows [Go Live] button only for completed backtest runs
- Clicking [Go Live] → POST /api/runs/:id/go-live
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
- initWorkspace with engine=hummingbot → creates strategy.py + conf_*.yml
- initWorkspace with engine=nautilus → creates strategy.py + config.py
- initWorkspace with engine=generic → creates empty workspace with README
```

**Done when:** `pnpm test --filter=server -- workspace` passes.

---

### 3.2 Engine Adapters

All four engines implemented in parallel. Each adapter implements the full `EngineAdapter` interface.

**Tasks:**
- [ ] `packages/engines/freqtrade/` — FreqtradeAdapter
- [ ] `packages/engines/hummingbot/` — HummingbotAdapter
- [ ] `packages/engines/nautilus/` — NautilusAdapter
- [ ] `packages/engines/generic/` — GenericAdapter (agent-written scripts)
- [ ] Each: `ensureInstalled()`, `downloadData()`, `runBacktest()`, `parseResult()`
- [ ] Each: `startLive()`, `stopLive()`, `getLiveStatus()`
- [ ] Trade entries parsed into TradeEntry[] for run_logs
- [ ] Engine registry: `getAdapter(engine) → EngineAdapter`

**Tests (per engine):**
```
Freqtrade:
- parseResult with real freqtrade JSON fixture → correct returnPct, drawdownPct, winRate, totalTrades
- parseResult extracts individual TradeEntry[] with pair, side, price, amount, pnl, timestamps
- parseResult with freqtrade error output → throws with meaningful message

Hummingbot:
- parseResult with hummingbot trade CSV fixture → correct NormalizedResult
- parseResult extracts TradeEntry[] from hummingbot format
- parseResult with hummingbot error output → throws with meaningful message

Nautilus:
- parseResult with nautilus backtest result fixture → correct NormalizedResult
- parseResult extracts TradeEntry[] from nautilus format
- parseResult with nautilus error output → throws with meaningful message

Generic:
- runBacktest executes agent-written script, parses stdout JSON → NormalizedResult
- runBacktest with non-JSON stdout → throws with meaningful message
- downloadData executes agent-written data script at expected workspace path

All engines:
- downloadData creates files at expected workspace path
- runBacktest with a known strategy produces non-empty result (integration, skippable in CI)
- startLive returns LiveHandle with process ID
- getLiveStatus on running handle → { running: true, unrealizedPnl, ... }
- stopLive → process terminated, getLiveStatus → { running: false }
- getAdapter("freqtrade") → FreqtradeAdapter instance
- getAdapter("unknown") → throws
```

**Done when:** `pnpm test --filter=engines-*` passes.

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
- [ ] Analytics + Risk Manager prompt templates
- [ ] Context assembly: desk config + experiment + runs + comments + memory
- [ ] Token budget enforcement

**Tests:**
```
- Prompt includes desk budget/target/stop-loss values
- Prompt includes "You are working on Experiment #N — {title}"
- Prompt includes last 3 run results as structured data
- With 100 comments, prompt only includes last N that fit within token budget
- When memory_summaries exist (desk level), they appear before raw comments
- Analytics prompt instructs agent to use desk's configured engine
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
- [ ] Proposal marker detection: `[PROPOSE_VALIDATION]`, `[PROPOSE_NEW_EXPERIMENT]`, `[PROPOSE_COMPLETE_EXPERIMENT]`, `[PROPOSE_GO_LIVE]`
- [ ] Button UI for approval (Approve / Decline)
- [ ] Risk Manager / new experiment / complete experiment / go-live execution on approval

**Tests:**
```
- Agent output with [PROPOSE_VALIDATION] → proposal UI shown to user
- User clicks approve → Risk Manager spawned
- User clicks decline → no action
- Agent output with [PROPOSE_NEW_EXPERIMENT] My Title → proposal UI shown
- User approves → experiment created with title "My Title", number auto-incremented
- Agent output with [PROPOSE_COMPLETE_EXPERIMENT] → proposal UI shown
- User approves → experiment status set to "completed", experiment summary generated
- Agent output with [PROPOSE_GO_LIVE] <runId> → proposal UI shown
- User approves → POST /api/runs/:id/go-live triggered
- Go-live without Risk Manager validation → warning shown, user can still proceed
```

**Done when:** `pnpm test --filter=server -- triggers` passes.

---

## Phase 6: WebSocket

**Tasks:**
- [ ] WebSocket server at `/api/experiments/:id/events/ws`
- [ ] Broadcast events: `run.status`, `run.live`, `comment.new`
- [ ] UI: LiveUpdatesProvider + auto-refresh components

**Tests:**
```
- Client on experiment A receives events for A only
- run.status event received within 1s of status change
- run.live event broadcasts live PnL/position updates
- comment.new contains full comment data
- UI RunTable and CommentThread auto-update on events
```

**Done when:** `pnpm test --filter=server -- websocket` passes, UI updates live.

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
- Click [Go Live] on run #2 → live run created (mode=live), run_logs stream pnl events
- Click Stop → live run stopped
```

**Done when:** `pnpm test:e2e` passes.

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
  Phase 8 (CLI)
      |
      v
  Phase 9 (E2E)
```
