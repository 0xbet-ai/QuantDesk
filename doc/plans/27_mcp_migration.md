# Phase 27 — Replace marker protocol with MCP tools

**Kind:** TODO (large refactor, multi-slice)

## Why

The current agent ↔ server protocol is a bracketed-marker honor system
(`[DATA_FETCH]...[/DATA_FETCH]`, `[DATASET]...[/DATASET]`, etc. — see
`doc/agent/MARKERS.md`). The agent is trusted to emit the tag verbatim, the
server regex-parses the response, and side effects fire post-hoc. Observed
problems in practice:

- **Silent drops.** The agent narrates "다운로드 요청을 보냈습니다" without
  actually emitting `[DATA_FETCH]`, and the server has no way to know — the
  turn ends, no download starts, the user waits forever.
- **Brittle parsing.** Regex-based `extractFirstBlockBody` breaks on
  malformed JSON, trailing commas, or nested brackets, and errors are
  swallowed by silent catches (`agent-trigger.ts` §8b was found doing this
  on 2026-04-09).
- **No feedback loop.** When a marker's side effect fails, the agent only
  learns about it via an inject-a-system-comment-and-retrigger round-trip.
  There is no in-turn error that the agent can read and retry.
- **Compounding defensive layers.** `firedMarkers` tracking, dead-end
  guards, `stripAgentMarkers`, `markers-spec` dispatch-coverage tests, and
  a growing prompt that begs the agent to "remember to emit the marker"
  are all band-aids on the same honor-system wound.

MCP (Model Context Protocol) replaces this with real tool calls. The LLM
SDK enforces the JSON schema, the tool call is a blocking RPC, and the
tool result lands back in the agent's context in the same turn. Most of
the marker infrastructure — parsers, strippers, coverage tests, firedMarkers
chips, dead-end guard — becomes unnecessary.

## Scope

Replace the entire marker protocol with an MCP server exposing the same
semantic actions as tools. Documentation (`doc/agent/MARKERS.md`) is
rewritten as `doc/agent/MCP.md` describing the tool contract. CLAUDE.md
"Read This First" is updated to point at the new file.

### Tools (initial set — 1:1 mapping with existing markers)

| Tool | Replaces marker | Notes |
|---|---|---|
| `data_fetch(exchange, pairs, timeframe, days, tradingMode, rationale)` | `[DATA_FETCH]` | Blocks until download finishes, returns dataset id + summary |
| `register_dataset(exchange, pairs, timeframe, dateRange, path)` | `[DATASET]` | For pre-downloaded data (seed workspace, mocks) |
| `run_backtest(strategyName, configFile?, entrypoint?)` | `[RUN_BACKTEST]` + `[BACKTEST_RESULT]` | Returns normalized metrics; `[BACKTEST_RESULT]` is absorbed into the return value |
| `set_experiment_title(title)` | `[EXPERIMENT_TITLE]` | |
| `request_validation()` | `[VALIDATION]` | Dispatches the Risk Manager turn and waits for verdict |
| `submit_rm_verdict(verdict, reason?)` | `[RM_APPROVE]` / `[RM_REJECT]` | Risk Manager only |
| `new_experiment(title, hypothesis)` | `[NEW_EXPERIMENT]` | |
| `complete_experiment(summary)` | `[COMPLETE_EXPERIMENT]` | |
| `go_paper(runId)` / `run_paper(runId)` | `[GO_PAPER]` / `[RUN_PAPER]` | |

### Conversational approval (rule #13)

Still applies. Tools that need consent (`data_fetch`, `request_validation`,
`new_experiment`, `complete_experiment`, `go_paper`) can only be called
after the user has agreed in a prior turn. This is still socially enforced
via the prompt, not by the server. The only change is the emission shape
(tool call vs. marker block).

## Non-goals

- Rewriting the engine adapter interface.
- Changing the `agent_turns` / `comments` / `runs` schema. Tool call
  transcripts are persisted as agent log entries, not as new DB tables.
- Live trading anything.

## Open questions

1. **Codex CLI support.** Claude Code CLI accepts an MCP server via
   `claude mcp add` (stdio transport). Codex CLI's MCP client support is
   unknown — need to confirm before committing. If Codex can't host an
   MCP client, the `codex` adapter path either (a) stays on markers as a
   legacy fallback or (b) is retired. Default assumption: retire Codex
   adapter if it blocks this phase; the current `AGENT_MODEL` default is
   `claude-opus-4-6` anyway.
2. **Where the MCP server lives.** Preferred: export a stdio MCP server
   from the existing `server/` process, spawned per agent subprocess.
   Shares DB, session, publish channels — no inter-process coupling.
3. **Tool result shape for long-running work.** `data_fetch` may take 30s+.
   Options:
   (a) Block the tool call — the agent subprocess waits, the turn stays
       "running", the UI already tails `data_fetch.progress` events.
   (b) Return immediately with a job id, require a follow-up
       `poll_data_fetch(jobId)` tool. More plumbing, less natural agent
       code.
   Default: (a). The existing run-log tail infrastructure already covers
   the "what's happening during the wait" UX.

## Status

- **27a** ✅ scaffold landed — zero-tool MCP server factory + stdio entry (6e670e0)
- **27b** ✅ data_fetch + register_dataset tools + CLI wiring (8294020)
- **27c** ✅ run_backtest tool (absorbs [BACKTEST_RESULT])
- **27d** ✅ lifecycle tools (set_experiment_title, request_validation, submit_rm_verdict, new_experiment, complete_experiment)
- **27e** ⏳ in progress — MCP.md written, CLAUDE.md updated, marker parser deletion deferred until a week of real runs confirms agents are calling tools instead of emitting brackets

**Architecture change vs original plan:** the MCP server is hosted **in-process** over HTTP at `POST /mcp` on the parent server, not as a stdio subprocess. Claude CLI connects via `--mcp-config` → `{"type":"http","url":"http://127.0.0.1:PORT/mcp","headers":{...}}`. Each request is stateless; experiment/desk context rides on `X-QuantDesk-Experiment` / `X-QuantDesk-Desk` headers. This gives tool handlers direct access to the parent's DB, event emitter, engine adapters, and `triggerAgent` without any cross-process RPC.

## Execution slices (each its own PR)

### 27a — MCP server scaffold

- Add MCP server dependency (Anthropic official TS SDK or `@modelcontextprotocol/sdk`).
- Create `server/src/mcp/server.ts` that constructs an MCP server with
  zero tools, registered in the agent CLI spawn path.
- Wire `claude mcp add` equivalent into `packages/adapters/src/claude/*`
  so the subprocess boots with the MCP server attached.
- Smoke test: agent can `list_tools` and see zero entries.

### 27b — `data_fetch` + `register_dataset` tools

- Port `executeDataFetch` into an MCP tool handler. Tool call blocks
  until the download finishes, returns `{ datasetId, linked, summary }`.
- Port the §8b `[DATASET]` insert path into `register_dataset`. Return
  `{ datasetId }` or a structured error with missing fields.
- Prompt update: `mode-classic` / `mode-realtime` / `mode-generic`
  stop telling the agent about `[DATA_FETCH]` / `[DATASET]`; they
  describe the tools instead.
- Keep the marker parsers in place as a transitional fallback — if the
  agent still emits a marker, the existing dispatch runs. A follow-up
  slice removes the marker parsers once we see zero marker emissions in
  real runs for a week.
- Tests: integration test that an agent turn invoking `data_fetch` via
  MCP produces a linked `desk_datasets` row and emits
  `data_fetch.progress` events.

### 27c — `run_backtest` tool (absorbs `[BACKTEST_RESULT]`)

- Port `RUN_BACKTEST` dispatch into a tool handler that runs the engine
  and returns normalized metrics in the tool result. Delete the separate
  `[BACKTEST_RESULT]` path — metrics come from the tool return value.
- UI: `RunCard` reads metrics from `runs.result` as before; no UI change
  expected.

### 27d — Lifecycle tools (titles, validation, new/complete experiment, paper)

- Port the remaining six markers in one slice (they share the same
  "parse body, mutate a row, optionally retrigger" shape).
- After this slice, the marker parsers and `stripAgentMarkers` can be
  deleted.

### 27e — Documentation + cleanup

- Replace `doc/agent/MARKERS.md` with `doc/agent/MCP.md`. Update the
  "Read This First" list in `CLAUDE.md` (requires explicit user approval
  per rule #11).
- Delete `server/src/services/markers-spec.ts` and its test.
- Delete `firedMarkers` UI chips in `CommentThread.tsx` (replace with a
  tool-call timeline rendered from the agent transcript — tool calls are
  already captured as structured log entries).
- Delete the dead-end guard's marker-presence heuristic — a turn with
  no tool calls AND no user question is still a dead end, the guard
  logic survives but the marker checks go away.
- Update `doc/plans/README.md` DONE list with a one-liner per CLAUDE.md
  rule #11, then delete this phase file.

## Risks

- **CLI transport fragility.** If the Claude CLI's MCP stdio bridge is
  flakier than the marker parser, we trade a known failure mode for an
  unknown one. Mitigation: 27b lands behind a feature flag
  (`AGENT_MCP=1`) so we can A/B with the marker path on real desks
  before committing.
- **Prompt regression.** Removing marker instructions from the mode
  prompts must not break the implicit "use the tool don't narrate" rule
  that the tool schema alone may not enforce strongly enough. Mitigation:
  keep a single sentence in each mode prompt — "Call tools to act; never
  describe an action without calling its tool."
- **Schema churn.** Tool schemas live in two places (TS types in
  `packages/shared` and the MCP JSON schema). Derive the JSON schema
  from Zod via `zodToJsonSchema` so there is one source of truth.

## Success criteria

- An agent turn that needs to download data emits a single MCP
  `data_fetch` call, the server downloads synchronously, and the tool
  return value appears in the next agent turn's context. No `[DATA_FETCH]`
  marker in the response.
- `grep -r "extractDataFetchRequest" server/src` returns zero hits after
  slice 27d.
- `doc/agent/MARKERS.md` is gone.
- `pnpm test` passes on every slice.
