# Agent MCP Tools

The protocol between the agent and the server is a set of MCP (Model Context Protocol) tools the agent calls during its turn. The server hosts an in-process MCP HTTP endpoint at `POST /mcp`; the Claude CLI connects to it via a per-turn `--mcp-config` file that carries the current experiment and desk context on request headers.

This file is the dispatch contract: each tool is documented as a function with a precondition (`requires`), an effect, and a postcondition (`postcond`). Cross-tool chaining is read by matching one tool's `postcond` to another's `requires` — the same way you'd reason about type signatures.

Authoritative definitions live in code:

- **Tool registration** — `server/src/mcp/server.ts`
- **HTTP entrypoint** — `server/src/mcp/http-route.ts`
- **Prompt** (what the agent is told about the tools) — `server/src/services/prompts/analyst-system.ts`
- **CLI wiring** — `server/src/services/agent-trigger.ts` (`buildMcpConfigForTurn`)

## Conversational approval (CLAUDE.md rule #13)

Every tool below that mutates global state (download, validation, new experiment, completion) is still subject to **conversational approval**. There is no "proposal" object, no approve/reject buttons, no server-side state machine. When an action needs user consent, the agent must **ask the user in plain text first**, end the turn, and wait for the user to reply affirmatively. The next turn — after the user agreed — is where the agent actually calls the tool.

```
turn N   agent: "I'd like to download 180 days of BTC/USDT 1h from binance.
                 Rationale: six-month baseline for the ADX+FastD momentum
                 thesis. OK to proceed, or adjust the exchange / pair /
                 range?"
                 (no tool call — turn ends, agent waits)

user: "yes, but use ETH/USDT instead."

turn N+1 agent: "Switching to ETH/USDT. Downloading now."
                → mcp__quantdesk__data_fetch({
                    exchange: "binance",
                    pairs: ["ETH/USDT"],
                    timeframe: "1h",
                    days: 180,
                    tradingMode: "spot",
                    rationale: "baseline per user instruction"
                  })
                ← { datasetId, path, ... }
                agent continues same turn with the return value in context
```

Tools that need conversational approval before they fire: `data_fetch`, `request_validation`, `new_experiment`, `complete_experiment`.

Tools that fire directly without asking: `register_dataset` (registering already-downloaded data — no network I/O), `run_backtest` (re-runs on the current desk's existing dataset are routine), `set_experiment_title` (cosmetic rename), `submit_rm_verdict` (the RM's own decision output).

## Tools

### `data_fetch`

```
data_fetch({ exchange, pairs[], timeframe, days, tradingMode?, rationale? })
  requires:  user has agreed in the immediately preceding exchange
  effect:    download data via engineAdapter.downloadData,
             insert a `datasets` row and a `desk_datasets` link
             (or reuse an existing row when the cache already holds it)
  returns:   { datasetId, exchange, pairs, timeframe, dateRange, path }
             on error: { isError: true, content: "…" } — read the text,
             correct the call, or ask the user on the same turn
  postcond:  desk has ≥1 desk_datasets link covering the requested range
             → matches run_backtest.requires
```

### `register_dataset`

```
register_dataset({ exchange, pairs[], timeframe, dateRange:{start,end}, path })
  requires:  the dataset already exists on disk
             (typically produced by a workspace-local fetch_data.py)
  effect:    insert a `datasets` row and a `desk_datasets` link
  returns:   { datasetId, linked: true }
  postcond:  desk has ≥1 desk_datasets link
             → matches run_backtest.requires
  notes:     call this BEFORE run_backtest whenever you downloaded
             data yourself instead of calling data_fetch. Missing
             this step is the #1 cause of "no dataset registered"
             run_backtest errors.
```

### `run_backtest`

```
run_backtest({ strategyName?, configFile?, entrypoint? })
  requires:  desk has ≥1 desk_datasets link
  effect:    engineAdapter.runBacktest() in a Docker container,
             insert a `runs` row with the normalized metrics,
             link it to the latest registered dataset
  returns:   { runId, runNumber, isBaseline, metrics[] }
             on error: { isError: true, content: "…" }
  postcond:  runs row exists with metrics + commit_hash
             → matches request_validation.requires
  notes:     the return value replaces the legacy [BACKTEST_RESULT]
             marker — you react to metrics on the same turn instead
             of emitting a separate result block.
```

### `run_script` vs `run_backtest` — when to use which

Both tools execute an agent-authored script inside the `quantdesk/generic` sandbox container (same image, same cache volumes, same entrypoint). The difference is what the server does with the result:

| Aspect | `run_script` | `run_backtest` |
|---|---|---|
| Purpose | Fetchers, setup scripts, exploration, any side-effecting script that is NOT the final strategy evaluation | The final strategy evaluation that produces comparable metrics |
| Stdout contract | Unstructured — whatever your script prints | LAST line MUST be a `NormalizedResult` JSON object (see `run_backtest` docs) |
| Parsing | None — raw text returned to the agent | Parsed; parse failure → the `runs` row is marked `failed` |
| DB side effect | None | Inserts a `runs` row with `runNumber`, `isBaseline`, `result.metrics[]`, links it to the latest dataset |
| WS events | `run.log_chunk` for live tail (no `runId`) | `run.log_chunk` with `runId` + `run.status` on start / completed / failed |
| Return value | `{ exitCode, stdout, stderr }` | `{ runId, runNumber, isBaseline, metrics[] }` |
| Engine scope | All desks — always runs in the generic sandbox image regardless of the desk's managed engine | All engines — managed engines use their own adapters instead of the generic container |
| Dataset requirement | None | Desk must have ≥1 registered dataset |

**Typical flow (all desks)**:

1. `Write` `fetch_data.py` (and `requirements.txt` if it needs libraries)
2. `run_script({ scriptPath: "fetch_data.py" })` → writes data under `/workspace/data/` (runs inside the generic sandbox, not the desk's managed engine container)
3. `register_dataset({ exchange, pairs, timeframe, dateRange, path })`
4. Refine `strategy.py` (or write `backtest.py` on generic desks — the entrypoint contract is engine-specific)
5. `run_backtest({ ... })` → `runs` row saved, metrics returned
6. React to the metrics on the same turn

Data fetching (steps 1-3) is always the agent's responsibility. The agent must ask the user for confirmation before fetching. See the "Data acquisition" section in the tools-glossary prompt.

Agent-authored scripts must ALWAYS go through one of these two tools. The `Bash` tool is for workspace housekeeping only (`ls`, `cat`, `git`, inspecting files) — never for executing scripts the agent wrote.

### `run_script`

```
run_script({ scriptPath })
  requires:  script exists at <workspace>/<scriptPath>
  effect:    runs the script inside the generic sandbox container
             (quantdesk/generic) with the workspace mounted at
             /workspace and the per-language cache volumes attached.
             The container entrypoint auto-installs dependencies from
             the matching manifest file (requirements.txt /
             package.json / Cargo.toml / go.mod) before execution.
             Available on every desk regardless of the managed
             engine — the engine container is only used by
             data_fetch / run_backtest; everything else the agent
             writes runs in the generic sandbox.
  returns:   { exitCode, stdout, stderr }
             on error: { isError: true, content: "…" }
  postcond:  side effects are whatever the script wrote to
             /workspace (typically data files under /workspace/data/);
             no runs row is created.
  notes:     Use this for fetchers, setup scripts, exploration, or
             anything that is NOT the final strategy evaluation. For
             the final evaluation call run_backtest instead — that
             tool parses NormalizedResult from stdout and persists a
             runs row with metrics. Agent-authored scripts must
             ALWAYS go through run_script or run_backtest, never
             through Bash directly, so they stay sandboxed.
```

### `set_experiment_title`

```
set_experiment_title({ title })  // ≤ 120 chars
  requires:  experiment.number ≠ 1   // Experiment #1 is pinned to "Baseline"
  effect:    update experiments.title
  returns:   { applied: bool, title? | reason? }
  postcond:  experiment has a human title
  notes:     cosmetic, no retrigger. Call whenever you think the
             current experiment needs a better name.
```

### `request_validation`

```
request_validation({})
  requires:  ≥1 runs row exists, user has agreed in the preceding exchange
  effect:    dispatch a Risk Manager turn via triggerAgent(experimentId, "risk_manager")
  returns:   { dispatched: "risk_manager" }
  postcond:  RM turn is scheduled; when it submits a verdict the
             analyst is retriggered automatically
```

### `submit_rm_verdict` (Risk Manager only)

```
submit_rm_verdict({ verdict: "approve" | "reject", reason? })
  requires:  latest run exists
  effect:    write result.validation = { verdict, reason, at } on the latest run
             retrigger the analyst
  returns:   { recorded: true, verdict }
  postcond:  analyst sees the verdict in its next prompt;
             result.validation.verdict === "approve" unlocks paper trading
```

### `new_experiment`

```
new_experiment({ title, hypothesis? })
  requires:  user has agreed in the preceding exchange
  effect:    close the current experiment (memory summary + status=completed),
             create a new experiment, retrigger the analyst on it
  returns:   { newExperimentId, title }
  postcond:  the new experiment is the current experiment
```

### `complete_experiment`

```
complete_experiment({ summary? })
  requires:  user has agreed in the preceding exchange
  effect:    close the current experiment (no new one is created);
             post a rule #12 system comment naming the next move
  returns:   { closed: true }
  postcond:  experiment is closed; desk is idle until the user
             starts a new experiment or closes the desk
```

### `go_paper`

```
go_paper({ runId })
  requires:  run.result.validation.verdict === "approve",
             desk has no active paper session (one per desk),
             user has agreed in the preceding exchange
  effect:    create a paper_sessions row (pending → running),
             spawn the engine's dry-run container with the desk's
             strategy, exchange, pairs, and budget as wallet size
  returns:   { sessionId, status: "running", containerName }
             on error: { isError: true, content: "…" }
  postcond:  paper session is running; desk has an active session.
             The agent does not need to supervise — the container
             runs independently. Observer turns (future) will wake
             the agent on notable events.
  notes:     generic desks do not support paper trading. Only
             managed-engine desks (classic, realtime) can promote.
```

### `stop_paper`

```
stop_paper({})
  requires:  desk has an active paper session
  effect:    graceful shutdown of the paper container, remove it,
             mark session as stopped
  returns:   { stopped: true, sessionId }
             on error: { isError: true, content: "…" }
  postcond:  paper session is stopped; desk can promote a new run.
             No retrigger — the user explicitly chose to stop.
  notes:     no user consent required. The user can also stop from
             the UI directly (REST API).
```

### `get_paper_status`

```
get_paper_status({})
  requires:  none
  effect:    read-only — fetch the active paper session row (if any)
             and, when running, call the engine adapter's
             getPaperStatus() to pull live PnL / open positions from
             the container. Never mutates state.
  returns:   active session:
             { active: true, sessionId, runId, status, engine,
               containerName, apiPort, startedAt, lastStatusAt,
               live: { running, unrealizedPnl, realizedPnl,
                       openPositions, uptime } | null }
             no active session:
             { active: false, lastSession?: { sessionId, runId,
               status, engine, startedAt, stoppedAt, error } }
             never run:
             { active: false, message: "No paper session has ever run…" }
  postcond:  none — read-only.
  notes:     the agent MUST call this whenever it answers the user
             about paper trading. Session context does not survive
             container lifecycle events, so guessing from memory
             produces hallucinated "still running" replies. No user
             consent required.
```

## Reading the chain

Trace the lifecycle by matching `postcond` to `requires`:

- `data_fetch.postcond` (≥1 desk_datasets link) → `run_backtest.requires`
- `register_dataset.postcond` (≥1 desk_datasets link) → `run_backtest.requires`
- `run_backtest.postcond` (runs row exists) → `request_validation.requires`
- `submit_rm_verdict` records the verdict on the latest run and wakes the analyst
- `submit_rm_verdict.postcond` (verdict=approve) → `go_paper.requires`
- `go_paper.postcond` (active paper session) → `stop_paper.requires`

There is no global state machine — only signatures lining up across turns. Adding a new tool means defining its `requires` and `postcond`; the chain falls out automatically wherever those facts already appear.

## Failure handling

There is **no automatic stage-level retry**. If a tool's effect fails, the tool returns `{ isError: true, content: "…" }` on the same turn. The agent reads the error in its working context and must respond with one of:

1. **A corrected tool call** — different parameters, a fallback path, or a different tool (`register_dataset` instead of `data_fetch`, etc.).
2. **A specific question to the user** — naming what the agent needs to proceed.

An apology, a passive "I'll wait for guidance", or a restatement of the failure counts as abandoning the task and violates the "never give up silently" rule in the analyst system prompt.

## Legacy marker protocol (retired)

The bracketed-marker protocol (`[DATA_FETCH]`, `[RUN_BACKTEST]`, etc.) that preceded this file has been fully deleted. `packages/shared/src/agent-markers.ts` still exports a defensive `stripAgentMarkers` that removes any stray bracket text before a comment is persisted, but nothing in the server parses or dispatches markers anymore. All lifecycle actions go through the MCP tools above.
