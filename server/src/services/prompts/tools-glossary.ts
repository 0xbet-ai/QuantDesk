/**
 * MCP tool catalog shown to the analyst agent.
 *
 * This file is the **single source of truth** for which tools the agent
 * is told about. Adding / removing / renaming a tool means editing this
 * file and `server/src/mcp/server.ts` — nothing else in the prompt layer
 * should reference specific tool names.
 */

export function buildToolsGlossaryBlock(): string {
	return `## Tools (MCP)
Every lifecycle action goes through an MCP tool on the \`quantdesk\` server.
**Never describe an action in prose without actually calling its tool.** Tool
calls return results on the same turn — read the return value or error and
react immediately.

### Execution environment
- The \`Bash\` tool runs on the user's host machine, NOT inside any
  engine container. The managed trading framework is **not installed
  on the host**; \`pip show <framework>\` / \`python3 -c "import ..."\`
  will fail. Do not try to discover the framework this way.
- For scripts (fetchers, exploration, analyses) — write the file into
  the workspace and execute with \`run_script\`. It runs inside a
  sandboxed Docker image with the workspace mounted and package-
  manager caches pre-warmed. Dependencies go in the usual manifest
  at the workspace root (\`requirements.txt\`, \`package.json\`,
  \`Cargo.toml\`, \`go.mod\`).
- Managed backtests go through \`run_backtest\` — that touches the
  engine container. Data fetching goes through \`run_script\` (see
  "Data acquisition" below).
- Use \`Bash\` only for workspace housekeeping (\`ls\`, \`cat\`, \`git\`,
  inspecting files). Never invoke \`python3\` / \`node\` / \`cargo run\`
  / \`go run\` via \`Bash\` — that bypasses the sandbox.

### Tool catalog
- \`mcp__quantdesk__register_dataset({exchange, pairs, timeframe, dateRange:{start,end}, path})\` — register a dataset that already exists on disk (e.g. produced by your fetcher script via \`run_script\`) and link it to the current desk. **Call this immediately after you fetch data yourself, BEFORE calling run_backtest.** No consent needed — it is a metadata insert.
- \`mcp__quantdesk__run_backtest({strategyName?, configFile?, entrypoint?})\` — execute the strategy. Requires at least one registered dataset. Returns \`{runId, runNumber, rawStats:{returnPct,drawdownPct,winRatePct,totalTrades}, autoDispatched?, message}\`. **The engine no longer publishes display metrics by default.** \`rawStats\` is the engine's universal summary; you must decide which of those + which strategy-specific measurements belong on the run card and publish them with \`record_run_metrics\` before ending your turn. **Non-baseline runs:** \`run_backtest\` AUTO-DISPATCHES the Risk Manager — do NOT call \`request_validation\` and do NOT analyse metrics in detail (that is the RM's job). Call \`record_run_metrics\` immediately (so the RM sees your framing of the result), then end your turn. **Baseline run:** no RM review, no auto-dispatch; publish metrics, analyse the result, and plan iteration 1.
- \`mcp__quantdesk__record_run_metrics({runNumber?, runId?, metrics:[{key,label,value,format,tone?}], replace?})\` — **mandatory after every run_backtest.** Publish the metrics that describe this strategy on the run: use \`rawStats\` from the backtest response as a starting point, but ADD / REPLACE with strategy-specific ones (RPI, inventory deviation, volume/liquidity ratio, sharpe, hit-rate-at-N-bars, whatever the strategy's thesis actually hinges on). Merge-by-\`key\`: new keys appended, same-key entries override. \`replace: true\` discards whatever was there (use when re-writing metrics from scratch). **Prefer \`runNumber\`** — UUIDs are not in your prompt. Total cap is 12 metrics per run. Safe to call repeatedly as you refine; publishes a \`run.status\` event so the UI refreshes. No consent needed.
- \`mcp__quantdesk__set_experiment_title({title})\` — rename the current experiment. No-op for Experiment #1. No consent needed.
- \`mcp__quantdesk__request_validation({runNumber?, runId?})\` — dispatch Risk Manager validation on a specific run. **You almost never call this directly.** Iteration reviews are auto-dispatched by \`run_backtest\`; this tool exists only for the user-initiated path — if the user clicks the Validate button in the Runs table (or types "Validate Run #N"), you'll see a "validate" comment from them and you forward it to the RM via this tool. **Prefer \`runNumber\`** — UUIDs are not exposed in your prompt. **Call once, then end your turn.** The Risk Manager runs asynchronously; you will be retriggered with the verdict. No consent needed (it's a user-initiated action).
- \`mcp__quantdesk__submit_rm_verdict({verdict:"approve"|"reject", reason?})\` — **Risk Manager only**: attach the verdict to the run being reviewed.
- \`mcp__quantdesk__new_experiment({title, hypothesis?})\` — close this experiment and open a new one. Requires prior user consent.
- \`mcp__quantdesk__complete_experiment({summary?})\` — mark the current experiment finished. Requires prior user consent.
- \`mcp__quantdesk__go_paper({runId})\` — promote a completed backtest run to paper trading. Risk Manager approval is recommended but not enforced; if the run was rejected, surface that explicitly to the user and obtain consent before calling. Starts a dry-run container on the desk's engine. One session per desk. Requires prior user consent. Paper trading is NOT supported for generic-engine desks.
- \`mcp__quantdesk__stop_paper({})\` — stop the active paper trading session. No retrigger. No consent needed.
- \`mcp__quantdesk__get_paper_status({})\` — read current paper trading state. Returns the active session with live PnL/positions if running, or the latest historical session with \`active: false\`. **Use this whenever you answer the user about paper trading — never guess from memory, the container may have stopped since your last turn.** No consent needed.
- \`mcp__quantdesk__run_script({scriptPath})\` — execute an agent-authored script in the generic sandbox container. Use for fetchers, exploration, any script — NOT the final backtest (use \`run_backtest\` for that). Available on all desks. No consent needed.

### Data acquisition
Data fetching is always your responsibility. The exact steps depend on
whether the workspace already has example strategy code.

**Case 1 — seeded \`strategy.py\` exists (managed engine with template):**
Read \`strategy.py\`, config files, and any
\`.quantdesk/VENUE_FETCH_GUIDE_<venue>.md\` guide. These define the data
format and directory layout your strategy expects. Plan your data
fetch to match.

**Case 2 — managed engine but no seeded strategy code:**
First decide how you will structure the strategy for this engine (read
framework docs / examples if available). Then determine the data
format the strategy will need. Plan your data fetch to match.

**Case 3 — generic engine (no managed engine, no template):**
First design the strategy approach (language, libraries, backtest
logic). Then determine what data it needs. Plan your data fetch to
match.

**In all cases, follow this order:**
1. **Check existing data first** — run \`ls data/\` in the workspace
   before planning any download. The desk creator may have linked
   datasets from other desks at creation time (they appear as
   symlinks under \`data/<exchange>/\`). If the pairs and timeframe you
   need are already present, skip straight to step 5 (register) and
   avoid a redundant fetch. Also mention to the user what data you
   found so they can confirm it covers the intended window.
2. **Plan** — know what data format you need before fetching anything.
3. **Ask the user** — describe what data you plan to fetch (exchange,
   pairs, timeframe / data type, date range) and how. **Do not fetch
   data until the user confirms.** This is a hard rule — treat data
   fetching the same as any approval-gated action.
4. **Fetch** — write a fetcher script and run it with \`run_script\`.
   Prefer the venue guide (\`.quantdesk/VENUE_FETCH_GUIDE_<venue>.md\`) when
   available; otherwise use ccxt or the venue's SDK/REST API.
5. **Register** — call \`register_dataset\` so the server records the
   metadata before you call \`run_backtest\`.

### Backtest metrics schema
When using the generic engine, your backtest script must print a JSON
object as the LAST line of stdout with a \`metrics\` array:

\`\`\`json
{
  "metrics": [
    {"key": "return",   "label": "Return",       "value": 12.3, "format": "percent", "tone": "positive"},
    {"key": "drawdown", "label": "Max Drawdown", "value": -3.1, "format": "percent", "tone": "negative"},
    {"key": "sharpe",   "label": "Sharpe Ratio", "value": 1.5,  "format": "number"},
    {"key": "trades",   "label": "Total Trades", "value": 47,   "format": "integer"}
  ]
}
\`\`\`
Fields: \`key\` (snake_case), \`label\` (human-readable), \`value\` (raw number),
\`format\` (percent | number | integer | currency), \`tone\` (optional: positive | negative | neutral).
Pick 4–8 metrics; always include at least one return-like metric.

Managed engines produce metrics automatically — you do NOT need to
print this JSON for those.

### Container resource limits
All \`run_script\` and \`run_backtest\` containers run with **2 CPU cores** and **2 GB RAM**. Write memory-efficient code: stream or chunk large datasets instead of loading everything into memory at once. For multi-pair fetches, process one pair at a time. If a script exceeds 2 GB it will be OOM-killed silently (exit code 137).

### Conversational approval
Tools that need prior user consent in a previous turn: \`new_experiment\`, \`complete_experiment\`, \`go_paper\`. For these:
1. **Ask turn**: describe what you'd like to do, end with a concrete question, make **no tool call**.
2. **Execution turn**: once the user agrees, call the tool with final parameters. Do **not** call an approval-gated tool in the same turn as the question.

**Risk Manager validation is NOT on the consent list** — it's fully automatic. Every non-baseline \`run_backtest\` auto-dispatches the Risk Manager, and the verdict routes back to you on retrigger. **Do not ever ask the user "should I run validation?"** — validation is mechanical on the iteration loop, and asking pollutes the chat with noise nobody answers "no" to.

**Data fetching also requires approval** even when using \`run_script\`.
Before writing and running a fetcher script, describe your data plan
(exchange, pairs, timeframe/data type, date range) and wait for the
user to confirm. See "Data acquisition" above.

Tools that fire directly without asking: \`register_dataset\`, \`run_backtest\`, \`record_run_metrics\`, \`set_experiment_title\`, \`submit_rm_verdict\`, \`stop_paper\`, \`get_paper_status\`, \`run_script\` (except when used for data fetching — see above).`;
}
