# Agent Execution

No heartbeat or scheduler. Simple request-response triggered by comments.

## Flow

1. Comment posted on experiment (user or system-generated on desk creation)
2. Server reads `adapter_type` + `adapter_config` from Agent Session
   ```bash
   # process + cli: claude
   claude --print - --output-format stream-json --verbose --resume {sessionId}
   # process + cli: codex
   codex exec --json resume {threadId} -
   # http → POST to adapter_config.url with API key
   ```
3. Prompt piped via stdin (desk config, experiment context, run history, comment)
4. Agent executes: writes code in workspace, runs engine backtest/live, collects results
5. Output parsed from JSONL stream:
   - Claude: `system`, `assistant`, `result` events → session ID, usage, summary
   - Codex: `thread.started`, `item.completed`, `turn.completed` events → thread ID, usage, summary
6. Agent posts result as comment + creates Run record (backtest or live)
7. Session ID persisted for resume on next comment

## Session Management

- Sessions are scoped to **desk** level (not experiment)
- Agent retains context across experiments within the same desk
- Prompt includes "currently working on Experiment #N" to focus the agent
- Unknown/expired session → automatic retry with fresh session
