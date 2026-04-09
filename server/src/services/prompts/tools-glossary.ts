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

- \`mcp__quantdesk__data_fetch({exchange, pairs, timeframe, days, tradingMode?, rationale?})\` — download market data and register it to this desk. Blocks until finished; returns \`{datasetId, exchange, pairs, timeframe, dateRange, path}\`. Requires prior user consent.
- \`mcp__quantdesk__register_dataset({exchange, pairs, timeframe, dateRange:{start,end}, path})\` — register an already-downloaded dataset (workspace-local fetch). **Call this immediately after you fetch data yourself, BEFORE calling run_backtest.** No consent needed — it is a metadata insert.
- \`mcp__quantdesk__run_backtest({strategyName?, configFile?, entrypoint?})\` — execute the strategy and return normalized metrics. Requires at least one registered dataset. Returns \`{runId, runNumber, metrics[]}\` — react to the metrics directly on the same turn.
- \`mcp__quantdesk__set_experiment_title({title})\` — rename the current experiment. No-op for Experiment #1. No consent needed.
- \`mcp__quantdesk__request_validation({})\` — dispatch Risk Manager validation on the latest run. Requires prior user consent.
- \`mcp__quantdesk__submit_rm_verdict({verdict:"approve"|"reject", reason?})\` — **Risk Manager only**: attach verdict to the latest run.
- \`mcp__quantdesk__new_experiment({title, hypothesis?})\` — close this experiment and open a new one. Requires prior user consent.
- \`mcp__quantdesk__complete_experiment({summary?})\` — mark the current experiment finished. Requires prior user consent.
- \`mcp__quantdesk__go_paper({runId})\` — promote a validated (Risk Manager approved) run to paper trading. Starts a dry-run container on the desk's engine. One session per desk. Requires prior user consent.
- \`mcp__quantdesk__stop_paper({})\` — stop the active paper trading session. No retrigger. No consent needed.
- \`mcp__quantdesk__run_script({scriptPath})\` — execute an agent-authored script in the generic sandbox container. Use for fetchers, exploration, any script — NOT the final backtest (use \`run_backtest\` for that). Available on all desks. No consent needed.

### Container resource limits
All \`run_script\` and \`run_backtest\` containers run with **2 CPU cores** and **2 GB RAM**. Write memory-efficient code: stream or chunk large datasets instead of loading everything into memory at once. For multi-pair fetches, process one pair at a time. If a script exceeds 2 GB it will be OOM-killed silently (exit code 137).

### Conversational approval
Tools that need prior user consent in a previous turn: \`data_fetch\`, \`request_validation\`, \`new_experiment\`, \`complete_experiment\`, \`go_paper\`. For these, the ask turn must make **no tool call**; the execution turn (after the user agrees) makes the call.

Tools that fire directly without asking: \`register_dataset\`, \`run_backtest\`, \`set_experiment_title\`, \`submit_rm_verdict\`, \`stop_paper\`, \`run_script\`.`;
}
