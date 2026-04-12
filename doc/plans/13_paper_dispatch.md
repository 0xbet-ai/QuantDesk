# 13 — Paper trading MCP tools (TODO: `run_paper` only)

**Status: PARTIAL.** `go_paper` is live (`server/src/mcp/server.ts`, registered around the "go_paper" tool handler; it calls `startPaper()` and returns `{sessionId, containerName}`). The only remaining slice is the `run_paper` non-interactive variant.

## What's still missing

`mcp__quantdesk__run_paper({runId})` — the server-driven recovery sibling of `go_paper`. Same `startPaper` flow (paper_gates already implemented), but without the user-consent expectation.

- Register the tool handler in `server/src/mcp/server.ts` next to the existing `go_paper` handler. Reuse `startPaper(runId)` directly — the gates already handle "one paper session per desk" and the validation-verdict precondition.
- Add it to `server/src/services/prompts/tools-glossary.ts` so the analyst knows when to use which: `go_paper` is the default (fresh human-in-the-loop promotion), `run_paper` is only for retrigger / observer-turn recovery paths where there is no new user consent to wait on.
- Update `doc/agent/MCP.md` with the `run_paper` signature + its precondition delta vs `go_paper`.

## Tests first

1. `mcp__quantdesk__run_paper({runId})` tool handler:
   - Same preconditions as `go_paper` (`runs.result.validation.verdict === "approve"`, one-paper-per-desk).
   - Returns `{sessionId, containerName}` on success.
   - Distinct from `go_paper` only in that it is expected on the recovery path, not the happy path — the tool glossary should reflect that.
