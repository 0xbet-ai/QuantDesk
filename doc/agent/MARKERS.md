# Agent Markers

The protocol between the agent and the server is a small set of bracketed markers the agent emits in its response. The server greps for them after each agent turn and runs the corresponding action — write to the DB, spawn an engine container, close the experiment, etc.

This file is the dispatch contract: each marker is documented as a function with a precondition (`requires`), an effect, and a postcondition (`postcond`). Cross-marker chaining is read by matching one marker's `postcond` to another's `requires` — the same way you'd reason about type signatures.

Authoritative definitions live in code:

- **Definitions** (what the agent is told to emit) — `server/src/services/prompts/`
- **Dispatch** — `server/src/services/agent-trigger.ts`
- **Stripping** (so markers never leak to the UI) — `packages/shared/src/agent-markers.ts`

## Conversational approval (CLAUDE.md rule #13)

Every marker below is an **action marker** — the server runs the side effect the moment the marker is parsed. There is no "proposal" category, no `pendingProposal` metadata, no approve/reject buttons. When an action needs user consent, the agent must **ask the user in plain text first**, end the turn, and wait for the user to reply affirmatively. The next turn — after the user has replied — is where the agent actually emits the action marker.

```
turn N   agent: "I'd like to download 180 days of BTC/USDT 1h from binance.
                 Rationale: six-month baseline for the ADX+FastD momentum
                 thesis. OK to proceed, or adjust the exchange / pair /
                 range?"
                 (no marker — turn ends, agent waits)

user: "yes, but use ETH/USDT instead."

turn N+1 agent: "Switching to ETH/USDT. Downloading now."
                [DATA_FETCH]
                {"exchange":"binance","pairs":["ETH/USDT"],"timeframe":"1h",
                 "days":180,"tradingMode":"spot",
                 "rationale":"baseline per user instruction"}
                [/DATA_FETCH]
```

Why this shape:

- Approval lives in the same message stream as everything else, so the user can reply with nuance ("yes but…", "no, try a different exchange", "wait, explain the rationale first") instead of being forced through binary approve / reject.
- The marker that the server actually executes is always the agent's reformulation *after* the user agreed — this guarantees the executed parameters match what was just discussed.
- The server has no state machine around pending approvals: if the user never replies, the lifecycle simply pauses at the question, which satisfies CLAUDE.md rule #12 (no dead-ends) because the agent's message is itself the next action.

Markers that need conversational approval before they fire: `DATA_FETCH`, `VALIDATION`, `NEW_EXPERIMENT`, `COMPLETE_EXPERIMENT`, `GO_PAPER`.

Markers that fire directly without asking: `DATASET` (registering already-downloaded data), `RUN_BACKTEST` (re-runs on the current desk's existing dataset are considered routine), `BACKTEST_RESULT` (posting a normalized result block), `EXPERIMENT_TITLE` (cosmetic rename), `RUN_PAPER` (the agent decided the run is ready and the user has already agreed in a prior turn).

## Action markers

`triggerAgent(experimentId)` in `server/src/services/agent-trigger.ts` is the single entry point. After the CLI subprocess returns, the server applies every matching marker in the response. **Branches are not mutually exclusive** — every matching marker fires within the same turn (the rule #13 refusal in `RUN_BACKTEST` is the only early return).

After every dispatch (except an early return), the server runs `stripAgentMarkers`, saves the agent comment, and emits `agent.done`.

```
DATA_FETCH(proposal: { exchange, pairs, timeframe, days, tradingMode, rationale })
  form:      [DATA_FETCH]\n{...json...}\n[/DATA_FETCH]
  requires:  user has agreed in the immediately preceding exchange
             (enforced socially via the prompt, not mechanically)
  effect:    parse JSON body
             cache hit  → link desk_datasets
             cache miss → engineAdapter.downloadData(proposal),
                          insert/extend the global datasets row, link
             post "Downloaded…" / "Already cached…" system comment
             retrigger
  postcond:  desk has ≥1 desk_datasets link covering the requested range
             // matches RUN_BACKTEST.requires
  branches:
             - cache_hit          → instant link, retrigger
             - cache_miss_success → download container, link, retrigger
             - download_failure   → system comment with error, retrigger
                                     (agent decides whether to ask the user
                                      about a different pair or window)
  user_next_action (per rule #12):
             cache_hit          → retrigger continues; no user action needed
             cache_miss_success → retrigger continues; no user action needed
             download_failure   → agent's next turn asks the user how to
                                  adjust (different exchange, shorter window,
                                  different pair naming)
  notes:     rule #13 forces the agent to ASK before emitting this on a
             brand-new desk — no code, no RUN_BACKTEST — until the user has
             replied affirmatively. Mid-lifecycle top-ups have no guard;
             the agent may ask for additional pairs / timeframes / windows
             at any time. engineAdapter.downloadData is engine-specific
             (Freqtrade CLI, Nautilus catalog ingest, generic agent-authored
             download scripts); the marker itself does not care which engine.
```

```
DATASET(entry: { name, exchange, pairs, timeframe, days })
  form:      [DATASET]\n{...json...}\n[/DATASET]
  requires:  —
  effect:    insert a `datasets` row and a `desk_datasets` link for the
             current desk. Used when data was already fetched out-of-band
             (e.g. a seed workspace with external datasets) and the agent
             just needs to register it with the server so the rule #13
             RUN_BACKTEST guard passes.
  postcond:  desk has ≥1 desk_datasets link
  notes:     no consent needed — this is a metadata insert, no download.
             The agent uses it after the workspace bootstrap exception in
             rule #13, or in mock setups where downloads are faked.
```

```
RUN_BACKTEST(config: { strategyName, configFile?, entrypoint? })
  form:      [RUN_BACKTEST]\n{...json...}\n[/RUN_BACKTEST]
  requires:  desk has ≥1 desk_datasets link
  effect:    engineAdapter.runBacktest() in Docker
             insert runs row (status = ok)
             post result system comment
             retrigger
  postcond:  runs row exists with metrics + commit_hash
  refusal:   if no desk_datasets link → post rule #13 refusal system comment,
             early return. The agent must ask the user about a data fetch
             first and emit [DATA_FETCH] once the user agrees.
  branches:
             - success            → retrigger handles next turn
             - engine_failure     → user must reply to retry
             - refusal_no_data    → agent asks the user about data fetch
  user_next_action (per rule #12):
             success         → none — retrigger continues automatically
             engine_failure  → system comment ends with "Reply with guidance
                               to retry."
             refusal_no_data → system comment tells the agent to ask the user
                               about the data fetch before retrying
  notes:     engine is resolved from desk.strategy_mode + venue (see
             ../engine/README.md); the marker itself is engine-agnostic.
             Re-running a backtest on an already-linked dataset is
             considered routine and does NOT require a prior conversational
             approval — the agent may emit this whenever it decides to test
             a code change. What requires approval is the DATA_FETCH that
             preceded it, not the re-run itself.
```

```
BACKTEST_RESULT(result: { metrics: [...] })
  form:      [BACKTEST_RESULT]\n{...json...}\n[/BACKTEST_RESULT]
  requires:  —
  effect:    attach the normalized result block to the agent comment's
             metadata so the UI can render metric chips and a result card.
             Typically emitted alongside or instead of a direct RUN_BACKTEST
             when the agent authored the backtest loop itself (generic mode)
             and wants to post structured output.
  postcond:  agent comment carries a renderable metrics block
  notes:     side-effect is cosmetic (UI rendering); no DB writes beyond
             the comment metadata.
```

```
VALIDATION()
  form:      [VALIDATION]
  requires:  ≥1 runs row exists, user has agreed in the preceding exchange
  effect:    dispatch a Risk Manager turn against the latest run
             (see ./ROLES.md). Retrigger the analyst with the verdict
             embedded.
  postcond:  RM verdict comment exists
  branches:
             - verdict_approve → analyst retriggered with positive verdict
             - verdict_reject  → analyst retriggered with rejection reason
  user_next_action (per rule #12):
             verdict_approve → retrigger continues; agent likely moves
                               toward GO_PAPER next (and will ask first)
             verdict_reject  → agent's next turn asks the user how to
                               address the risk manager's concerns
  notes:     this is the only path that wakes the Risk Manager. The agent
             must ask the user first ("Should I run risk manager validation
             on run #N?") and emit [VALIDATION] only after the user agrees.
```

```
NEW_EXPERIMENT(title: string)
  form:      [NEW_EXPERIMENT] <title>
  requires:  user has agreed in the preceding exchange
  effect:    create new experiments row, switch context, retrigger
  postcond:  new experiment is current
  user_next_action (per rule #12):
             none — the retrigger continues the lifecycle in the fresh
             experiment. The agent's next turn is the first turn of the
             new experiment.
  notes:     the agent must ask the user first ("Current hypothesis looks
             settled. Start a new experiment titled '...'?") and emit
             [NEW_EXPERIMENT] only after the user agrees.
```

```
COMPLETE_EXPERIMENT()
  form:      [COMPLETE_EXPERIMENT]
  requires:  user has agreed in the preceding exchange
  effect:    mark the experiment complete (no retrigger)
  postcond:  experiment is closed
  user_next_action (per rule #12):
             the closing system comment names the next move ("Start a new
             experiment or close the desk.")
  notes:     the agent must ask the user first ("Ready to close this
             experiment and move on?") and emit [COMPLETE_EXPERIMENT] only
             after the user agrees.
```

```
GO_PAPER(runId: string)
  form:      [GO_PAPER] <runId>
  requires:  the referenced runs row is validated,
             user has agreed in the preceding exchange
  effect:    promote the run into a long-lived paper session
             (see ./PAPER_LIFECYCLE.md for the state machine)
  postcond:  paperSessions row exists in `pending`
  branches:
             - launched                → paper widget visible on desk header
             - rejected_no_validation  → refusal comment names VALIDATION
             - rejected_active_session → refusal comment names the existing session
  user_next_action (per rule #12):
             launched                  → desk header surfaces the live paper widget
             rejected_no_validation    → agent asks the user about validation
             rejected_active_session   → agent asks the user about stopping the
                                          existing session
  notes:     the agent must ask the user first ("Run #N is validated.
             Promote it to paper trading?") and emit [GO_PAPER] only after
             the user agrees. `GO_PAPER` and the direct-action `RUN_PAPER`
             below have the same effect; the only difference is whether the
             agent is acting on a user that has just agreed (GO_PAPER) or
             executing a decision the user made earlier in the conversation
             and is now confirming (RUN_PAPER).
```

```
RUN_PAPER(runId: string)
  form:      [RUN_PAPER] <runId>
  requires:  the referenced runs row is validated,
             desk has no active paper session
  effect:    promote the run into a long-lived paper session
             (see ./PAPER_LIFECYCLE.md for the state machine)
  postcond:  paperSessions row exists in `pending`
  branches:
             - launched                → paper widget visible on desk header
             - rejected_no_validation  → refusal comment asks the user
                                          about validation
             - rejected_active_session → refusal comment names the existing session
  notes:     use RUN_PAPER when the agent has already cleared the decision
             with the user earlier in the conversation and is now executing
             it as part of a larger multi-step plan. Use GO_PAPER when the
             agent is acting on an immediate affirmative reply. In practice
             most flows use GO_PAPER; RUN_PAPER exists for replay and
             observer-turn recovery paths. Paper sessions leave the
             turn-based lifecycle entirely; observer turns and
             reconciliation are owned by PAPER_LIFECYCLE.md.
```

```
EXPERIMENT_TITLE(title: string)  // ≤ 8 words
  form:      [EXPERIMENT_TITLE] <title>
  requires:  experiment.number ≠ 1   // first experiment is permanently `Baseline`
  effect:    update experiments.title
  postcond:  experiment has a human title
  branches:  - applied / - ignored_baseline
  user_next_action: none — metadata-only marker, never a turn boundary
  notes:     rides along on whatever turn it appears in; no retrigger of its own.
             No consent needed — cosmetic rename.
```

### No-marker turn (terminal)

A turn that emits no markers is the **terminal state** of the turn cycle. The server saves the comment, emits `agent.done`, and stops. No system comment, no retrigger.

This is intentional: a turn that emits markers wants the server to advance the lifecycle; a turn that emits none wants the user back in the loop. There is no "default action" the server invents on the agent's behalf.

**Per rule #12 (no user dead-ends)**, a no-marker turn must end with a concrete question or explicit next step the user can reply to. This is how the conversational approval pattern works: the agent asks, ends the turn with no marker, and waits for the user to reply. The agent's own message is the "next action" the rule requires.

## Reading the chain

Trace the lifecycle by matching `postcond` to `requires`:

- `DATA_FETCH.postcond` (≥1 desk_datasets link) → `RUN_BACKTEST.requires`
- `DATASET.postcond` (≥1 desk_datasets link) → `RUN_BACKTEST.requires`  // bootstrap path
- `RUN_BACKTEST.postcond` (runs row exists) → `VALIDATION.requires`, `GO_PAPER.requires`
- `GO_PAPER.postcond` / `RUN_PAPER.postcond` (paperSessions row) → leaves into `PAPER_LIFECYCLE.md`

There is no global state machine — only signatures lining up across turns. Adding a new marker means defining its `requires` and `postcond`; the chain falls out automatically wherever those facts already appear in the current set.

## Failure handling

There is **no automatic stage-level retry**. If a marker's effect fails, the run/turn is marked `failed` and the lifecycle stops — the server does not re-dispatch the same marker, and it does not advance to a downstream marker. (CLI plumbing — e.g. retrying with a fresh session id when the previous one expired — is handled at the subprocess layer in `./TURN.md` and is not a lifecycle retry.)

- **`DATA_FETCH` download** — error posts a system comment describing the failure and retriggers the agent. The agent's next turn asks the user how to adjust (different pair naming, shorter window, different exchange) and emits a revised `[DATA_FETCH]` only after the user has agreed.
- **`RUN_BACKTEST`** — engine/container error inserts the runs row with `status = failed` and posts the error as a system comment. No analysis turn is auto-dispatched. The next turn is a fresh `triggerAgent` triggered by the failure comment: the agent reads the failure, may edit `strategy.py`, and emits a *new* `[RUN_BACKTEST]` which becomes a new runs row. The failed run is preserved for history, never mutated in place.
- **Agent CLI crash** — turn ends with no comment saved. The user retriggers by commenting again.

Retry is therefore always **agent-driven and user-gated**, never a silent server loop. This keeps the audit trail (runs, comments, commits) linear and prevents runaway Docker spend on a broken strategy.

## Notes

- **Markers are never shown to the user.** Before the agent's response is persisted as a comment, `stripAgentMarkers` removes every bracketed marker block. The UI only ever sees the human-readable text; structured intent is carried separately as a side-effect of the parsed marker (e.g. an inserted `runs` row, a new `datasets` link, a fresh experiment).
- Line markers must appear at the start of a line; block markers (`[DATA_FETCH]`, `[RUN_BACKTEST]`, `[DATASET]`, `[BACKTEST_RESULT]`) tolerate inline placement because they are matched as bracketed blocks.
- Adding a new marker means: (1) teach the agent about it in the mode prompt blocks, (2) add a parser in `agent-trigger.ts`, (3) add it to `stripAgentMarkers` so it doesn't leak to the UI, (4) add a function-signature entry to the relevant section above with `requires` / `effect` / `postcond`, (5) decide whether it needs conversational approval (add to the list in the "Conversational approval" section above) or is a direct action.
