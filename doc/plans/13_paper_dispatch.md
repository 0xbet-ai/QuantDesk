# 13 — Paper trading MCP tools (go_paper / run_paper) (TODO)

Spec: `doc/agent/MCP.md` paper-promotion tools. The lifecycle tool set already includes `request_validation` / `submit_rm_verdict`, but the paper-promotion tools are not yet wired up.

## Tests first

1. `mcp__quantdesk__go_paper({runId})` tool handler:
   - Requires `runs.result.validation.verdict === "approve"` on the referenced run. Otherwise returns an `isError` result that tells the agent to ask the user about validation.
   - Rejects when the desk already has an active paper session (one paper session per desk, by design).
   - On success calls `startPaperSession(runId)` (phase 12 gates) → invokes `engineAdapter.startPaper()` → stores the returned `containerId` on the `paperSessions` row.
2. The launched container carries `quantdesk.runId`, `quantdesk.deskId`, `quantdesk.engine`, `quantdesk.kind=paper` labels — verify Freqtrade (already true) and add for any other adapter that lacks them.
3. `mcp__quantdesk__run_paper({runId})` is the non-interactive variant for retrigger and observer-turn recovery paths; it runs the same `startPaperSession` flow without the user-consent expectation. Agents should normally use `go_paper`; `run_paper` exists for server-driven recovery.
4. Both tools return `{ sessionId, containerId }` on success.

## Then implement

- Register `go_paper` and `run_paper` tool handlers in `server/src/mcp/server.ts`.
- Handlers call into `paper-sessions.startPaperSession` + `engineAdapter.startPaper`.
- Update the prompt tool glossary (`server/src/services/prompts/tools-glossary.ts`) so the analyst knows both tools exist and which one to call.
- Update `doc/agent/MCP.md` with the two tool signatures + precondition chain.
