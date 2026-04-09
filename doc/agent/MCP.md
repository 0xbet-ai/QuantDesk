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

## Reading the chain

Trace the lifecycle by matching `postcond` to `requires`:

- `data_fetch.postcond` (≥1 desk_datasets link) → `run_backtest.requires`
- `register_dataset.postcond` (≥1 desk_datasets link) → `run_backtest.requires`
- `run_backtest.postcond` (runs row exists) → `request_validation.requires`
- `submit_rm_verdict` records the verdict on the latest run and wakes the analyst

There is no global state machine — only signatures lining up across turns. Adding a new tool means defining its `requires` and `postcond`; the chain falls out automatically wherever those facts already appear.

## Failure handling

There is **no automatic stage-level retry**. If a tool's effect fails, the tool returns `{ isError: true, content: "…" }` on the same turn. The agent reads the error in its working context and must respond with one of:

1. **A corrected tool call** — different parameters, a fallback path, or a different tool (`register_dataset` instead of `data_fetch`, etc.).
2. **A specific question to the user** — naming what the agent needs to proceed.

An apology, a passive "I'll wait for guidance", or a restatement of the failure counts as abandoning the task and violates the "never give up silently" rule in the analyst system prompt.

## Legacy marker protocol

The legacy bracketed-marker protocol (`[DATA_FETCH]`, `[RUN_BACKTEST]`, etc.) is still parsed by `agent-trigger.ts` as a fallback during the phase 27 migration. Tool calls are the authoritative path — they return structured results on the same turn, which is how the agent recovers from transient failures without the inject-a-system-comment-and-retrigger round-trip the markers required.

Once a week of real runs shows zero marker emissions, the marker parsers will be deleted in a follow-up cleanup slice (see `doc/plans/27_mcp_migration.md`).
