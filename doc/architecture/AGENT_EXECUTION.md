# Agent Execution

No heartbeat or scheduler. Simple request-response triggered by user comments.

## Flow

1. User posts comment on experiment
2. Server spawns AI CLI subprocess via adapter
   ```bash
   # Claude CLI
   claude --print - --output-format stream-json --verbose --resume {sessionId}
   # Codex CLI
   codex exec --json resume {threadId} -
   ```
3. Prompt piped via stdin (desk config, experiment context, run history, comment)
4. Agent executes: writes code in workspace, runs engine backtest/live, collects results
5. Output parsed from JSONL stream:
   - Claude: `system`, `assistant`, `result` events → session ID, usage, summary
   - Codex: `thread.started`, `item.completed`, `turn.completed` events → thread ID, usage, summary
6. Agent posts result as comment + creates Run record if backtest was executed
7. Session ID persisted for resume on next comment

## Session Management

- Sessions are scoped to **desk** level (not experiment)
- Agent retains context across experiments within the same desk
- Prompt includes "currently working on Experiment #N" to focus the agent
- Unknown/expired session → automatic retry with fresh session
