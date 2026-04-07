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
3. Prompt piped via stdin. The prompt context includes:
   - Desk config (budget, target_return, stop_loss, venues)
   - **`desk.strategy_mode`** (`classic` | `realtime`) and the resolved **`desk.engine`** (`freqtrade` | `nautilus` | `generic`), both immutable
   - Mode-specific instructions: which engine API the agent must use (Freqtrade `IStrategy` for classic, Nautilus `Strategy` event handlers for realtime, agent-authored script for generic)
   - **Paper trading is forbidden for generic desks** — the prompt instructs the agent to not propose `[PROPOSE_GO_PAPER]` in that case
   - Experiment context, run history, the triggering comment
4. Agent executes: writes code in workspace, runs engine backtest/paper (inside a Docker container), collects results
5. Output parsed from JSONL stream:
   - Claude: `system`, `assistant`, `result` events → session ID, usage, summary
   - Codex: `thread.started`, `item.completed`, `turn.completed` events → thread ID, usage, summary
6. Agent posts result as comment + creates Run record (backtest or paper)
7. Session ID persisted for resume on next comment

## Session Management

- Sessions are scoped to **desk** level (not experiment)
- Agent retains context across experiments within the same desk
- Prompt includes "currently working on Experiment #N" to focus the agent
- Unknown/expired session → automatic retry with fresh session
