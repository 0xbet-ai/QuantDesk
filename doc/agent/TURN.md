# Agent Turn

How a single agent turn is executed: from a new comment, through the CLI subprocess, to the persisted session ID. There is no heartbeat or scheduler — every turn is request-response triggered by a comment. For how turns chain together (marker branching, retriggers, lifecycle) see `./MARKERS.md`.

## Flow

1. A new comment is posted on an experiment — by the user, by the system on desk creation, or by the server itself as a follow-up to a marker action (e.g. the backtest-result system comment that follows a server-run backtest).
2. `triggerAgent(experimentId)` loads the desk's `agentSessions` row and resolves the adapter from `adapter_type`. Two adapters are registered: `claude` and `codex` (`packages/adapters/src/registry.ts`).
3. The adapter builds the spawn args:
   ```bash
   # claude
   claude -p - --output-format stream-json --verbose \
     --dangerously-skip-permissions [--resume <sessionId>]

   # codex
   codex exec --json [resume <sessionId>] -
   ```
4. The full prompt is built by `prompt-builder.ts` and piped via stdin. Context includes desk config, immutable `strategy_mode` / `engine`, mode-specific code-writing instructions, recent comments, run history, and registered datasets.
5. The CLI subprocess streams JSONL events on stdout. The adapter parses them into `StreamChunk`s and the server forwards each chunk to the UI in real time:
   - claude: `system` / `assistant` / `result`
   - codex: `thread.started` / `item.completed` / `turn.completed`
6. After the subprocess exits, the server processes the final `result.resultText` and dispatches on the markers it contains — see `./MARKERS.md` for the full branching.
7. The session id (or codex thread id) is persisted on `agent_sessions.session_id` so the next turn can resume the same conversation.

## Session Management

- Sessions are scoped to **desk** level (not experiment)
- Agent retains context across experiments within the same desk
- Prompt includes "currently working on Experiment #N" to focus the agent
- Unknown/expired session → automatic retry with fresh session

## See also

- `./MARKERS.md` — marker glossary, truth table, and turn-to-turn dispatch
