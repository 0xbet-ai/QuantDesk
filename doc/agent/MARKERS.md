# Agent Markers

The protocol between the agent and the server is a small set of bracketed markers the agent emits in its response. The server greps for them after each agent turn and either takes an action (e.g. run a backtest) or attaches metadata to the agent's comment.

This file is both the **glossary** and the **operational truth table** for how each marker is dispatched. The authoritative definitions live in code:

- **Definitions** (what the agent is told to emit) — `server/src/services/prompt-builder.ts`
- **Action markers** (parsed and acted on at the end of every turn) — `server/src/services/agent-trigger.ts`
- **Proposal markers** (parsed into pending-proposal metadata on the comment) — `server/src/services/triggers.ts`
- **Stripping** (so markers never leak to the UI) — `packages/shared/src/agent-markers.ts`

Markers split into two categories with fundamentally different dispatch semantics:

- **Action markers** — the server runs a real side effect (DB write, Docker spawn, system comment) the moment the agent turn ends. Most retrigger a fresh agent turn afterwards.
- **Proposal markers** — the server only attaches `pendingProposal` metadata to the agent comment. The actual state change happens later, when (and if) the user clicks Approve in the UI. User clicks are ordinary HTTP requests outside the marker protocol and are not modelled here.

`triggerAgent(experimentId)` in `server/src/services/agent-trigger.ts` is the single entry point for every agent turn. After the CLI subprocess returns, the server applies every matching row from the two tables below. **Branches are not mutually exclusive** — every matching row fires within the same turn (the rule #13 refusal in row A1′ is the only early `return`).

After every row (except A1′ which returns early), the server always runs `stripAgentMarkers` and saves the agent comment, then emits `agent.done`.

## How to read the tables

Each row is one marker handler:

- **Form** — exactly what the agent emits.
- **Input (guard)** — what must already be true on the desk for this row to fire.
- **Side effect** — what the server does when the row fires.
- **Output** — what is true on the desk after the side effect. The output of one row is the input of the next row that fires, in the next turn. That implicit chain *is* the lifecycle — there is no global state machine, only inputs and outputs lining up across turns.
- **Retrigger?** (Action table only) — whether the side effect ends with a fresh `triggerAgent` call. Proposal rows never retrigger by themselves.

The cross-turn order that emerges is **data fetch → strategy + backtest → analysis**. You can read it off the tables by following outputs back to inputs.

## Action markers

The server executes the side effect immediately when the marker is parsed.

| # | Marker | Form | Input (guard) | Side effect | Output | Retrigger? |
|---|---|---|---|---|---|---|
| A1 | `[RUN_BACKTEST]` | <code>[RUN_BACKTEST]\n{strategyName, configFile?, entrypoint?}\n[/RUN_BACKTEST]</code> | desk has at least one `desk_datasets` link | `engineAdapter.runBacktest()` in Docker, insert `runs` row, post result system comment | `runs` row exists with metrics + `commit_hash` | **yes** |
| A1′ | `[RUN_BACKTEST]` (refusal) | same as A1 | desk has **no** `desk_datasets` links | post rule #13 refusal system comment, **early return** (no other rows fire this turn) | nothing changes; lifecycle bounces back to a `[PROPOSE_DATA_FETCH]` (P1) | no |
| A2 | `[RUN_PAPER]` | `[RUN_PAPER] <runId>` | the referenced `runs` row is validated; no active paper session on the desk | promote the run into a long-lived paper session — see `./PAPER_LIFECYCLE.md` | `paperSessions` row exists in `pending` | (paper sessions leave the turn-based lifecycle — see `./PAPER_LIFECYCLE.md`) |
| A3 | `[EXPERIMENT_TITLE]` | `[EXPERIMENT_TITLE] <short title, max 8 words>` | none. **Ignored when `experiment.number === 1`** — the first experiment of every desk is permanently `Baseline` | update `experiments.title` | experiment has a human title | no (rides along on whatever turn it appears in) |
| A4 | **no markers** | plain text | n/a | save the agent comment as plain analysis text | agent comment saved; nothing else changes | **no** — lifecycle pauses, the next turn requires a fresh user comment |

### Why "no markers" is a row

Plain-text analysis is the **terminal state** of a turn. The server has nothing to do beyond saving the comment, so no system comment is posted, no retrigger fires, and the desk just sits there until the user comments again. A turn that emits markers wants the server to advance the lifecycle; a turn that emits none wants the user back in the loop. There is no "default action" the server invents on the agent's behalf.

## Proposal markers

The server only attaches `pendingProposal` metadata to the agent comment. The agent turn ends immediately. The actual state change happens later via an ordinary user-driven HTTP request when the user clicks Approve. If the user never decides, the lifecycle simply pauses on that comment forever — there is no timeout.

| # | Marker | Form | Input (guard) | Side effect | Output | On Approve |
|---|---|---|---|---|---|---|
| P1 | `[PROPOSE_DATA_FETCH]` | <code>[PROPOSE_DATA_FETCH]\n{exchange, pairs, timeframe, days, tradingMode, rationale}\n[/PROPOSE_DATA_FETCH]</code> | dispatch level: none. Two scenarios exist: **(a) brand-new desk** (zero `desk_datasets` links) — the prompt forces P1 to be the agent's *first* response, with no code and no `[RUN_BACKTEST]`, per rule #13; if the agent skips it the next turn is caught by A1′. **(b) mid-lifecycle top-up** — when the desk already has `desk_datasets` links but the agent wants a different pair / timeframe / window, it may emit P1 freely | parse JSON body, attach `pendingProposal` to the agent comment | comment carries Approve/Reject buttons | resolve dataset against the global cache: full hit → just link `desk_datasets`; partial hit or miss → call `engineAdapter.downloadData(proposal)` (engine-specific mechanism — see `../engine/README.md`), validate, insert or extend the global `datasets` row, then link `desk_datasets`. Post `Downloaded…` / `Already cached…` system comment. The desk now satisfies A1's guard. Retrigger. |
| P2 | `[PROPOSE_VALIDATION]` | `[PROPOSE_VALIDATION]` | at least one `runs` row exists | attach `pendingProposal` | comment carries Approve/Reject buttons | dispatch a Risk Manager turn against the latest run — see `./ROLES.md`. Retrigger analyst with the verdict embedded. |
| P3 | `[PROPOSE_NEW_EXPERIMENT]` | `[PROPOSE_NEW_EXPERIMENT] <title>` | none. The agent is instructed to only propose this when the current hypothesis is settled — never for routine parameter tuning | attach `pendingProposal` | comment carries Approve/Reject buttons | create new `experiments` row, switch context. Retrigger. |
| P4 | `[PROPOSE_COMPLETE_EXPERIMENT]` | `[PROPOSE_COMPLETE_EXPERIMENT]` | none | attach `pendingProposal` | comment carries Approve/Reject buttons | mark the experiment complete. No retrigger. |
| P5 | `[PROPOSE_GO_PAPER]` | `[PROPOSE_GO_PAPER] <runId>` | the referenced `runs` row is validated | attach `pendingProposal` | comment carries Approve/Reject buttons | run the same side effect as A2 (`[RUN_PAPER]`). |

### Why `[PROPOSE_DATA_FETCH]` is a Proposal not an Action

Despite being the entry point of the rule #13 lifecycle, `[PROPOSE_DATA_FETCH]` is mechanically identical to the other Proposal markers: the server only attaches `pendingProposal` and stops. The download only happens after the user clicks Approve. The "first-run-only" framing in CLAUDE.md rule #13 is enforced at the **prompt** level (the agent is told it must propose first), not at the marker dispatch level. The server-side enforcement lives in row A1′, not in P1.

## Failure handling

There is **no automatic retry** anywhere. If a row's side effect fails, the run/turn is marked `failed` and the lifecycle stops — the server does not re-dispatch the same row on its own, and it does **not** advance to a downstream row.

- **P1 download (post-Approve)** — error posts a system comment describing the failure and retriggers the agent. The agent decides whether to propose a revised `[PROPOSE_DATA_FETCH]` (e.g. different pair naming, shorter window) or give up.
- **A1 backtest** — engine/container error inserts the `runs` row with `status = failed` and posts the error as a system comment. No analysis turn is auto-dispatched. The next turn is a fresh `triggerAgent` triggered by the failure comment: the agent reads the failure, may edit `strategy.py`, and emits a **new** `[RUN_BACKTEST]` which becomes a new `runs` row. The failed run is preserved for history, never mutated in place.
- **Agent CLI crash** — turn ends with no comment saved. The user retriggers by commenting again.

Retry is therefore always **agent-driven and user-gated**, never a silent server loop. This keeps the audit trail (runs, comments, commits) linear and prevents runaway Docker spend on a broken strategy.

## Notes

- **Markers are never shown to the user.** Before the agent's response is persisted as a comment, `stripAgentMarkers` removes every bracketed marker block. The UI only ever sees the human-readable text; structured intent is carried separately on the comment's `metadata` (`pendingProposal`) or as a side-effect of the parsed marker (e.g. an inserted `runs` row).
- Proposal markers must appear at the start of a line; action markers tolerate inline placement because they are matched as bracketed blocks.
- Adding a new marker means: (1) teach the agent about it in `prompt-builder.ts`, (2) add a parser in `agent-trigger.ts` (Action) or `triggers.ts` (Proposal), (3) add it to `stripAgentMarkers` so it doesn't leak to the UI, (4) add a row to the relevant table above.
