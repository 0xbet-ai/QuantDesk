# Agent Markers

The protocol between the agent and the server is a small set of bracketed markers the agent emits in its response. The server greps for them after each agent turn and either takes an action (e.g. run a backtest) or attaches metadata to the agent's comment.

This file is the dispatch contract: each marker is documented as a function with a precondition (`requires`), an effect, and a postcondition (`postcond`). Cross-marker chaining is read by matching one marker's `postcond` to another's `requires` — the same way you'd reason about type signatures.

Authoritative definitions live in code:

- **Definitions** (what the agent is told to emit) — `server/src/services/prompt-builder.ts`
- **Action markers** — `server/src/services/agent-trigger.ts`
- **Proposal markers** — `server/src/services/triggers.ts`
- **Stripping** (so markers never leak to the UI) — `packages/shared/src/agent-markers.ts`

## Two categories

- **Action markers** — server runs a real side effect the moment the marker is parsed. Most retrigger a fresh agent turn afterwards.
- **Proposal markers** — server only attaches `pendingProposal` metadata. The actual state change happens later when (and if) the user clicks Approve. User clicks are ordinary HTTP requests outside the marker protocol and are not modelled here.

`triggerAgent(experimentId)` in `server/src/services/agent-trigger.ts` is the single entry point. After the CLI subprocess returns, the server applies every matching marker in the response. **Branches are not mutually exclusive** — every matching marker fires within the same turn (the rule #13 refusal in `RUN_BACKTEST` is the only early return).

After every dispatch (except an early return), the server runs `stripAgentMarkers`, saves the agent comment, and emits `agent.done`.

## Action markers

```
RUN_BACKTEST(config: { strategyName, configFile?, entrypoint? })
  category:  Action
  form:      [RUN_BACKTEST]\n{...json...}\n[/RUN_BACKTEST]
  requires:  desk has ≥1 desk_datasets link
  effect:    engineAdapter.runBacktest() in Docker
             insert runs row (status = ok)
             post result system comment
             retrigger
  postcond:  runs row exists with metrics + commit_hash
  refusal:   if no desk_datasets link → post rule #13 refusal system comment, early return.
             Lifecycle bounces back to a PROPOSE_DATA_FETCH proposal.
  branches:
             - success            → retrigger handles next turn
             - engine_failure     → user must reply to retry
             - refusal_no_data    → agent will re-propose; user can also nudge
  user_next_action (per rule #15):
             success         → none — retrigger continues automatically
             engine_failure  → system comment ends with "Reply with guidance to retry."
             refusal_no_data → system comment names PROPOSE_DATA_FETCH as the required next step
  notes:     engine is resolved from desk.strategy_mode + venue (see ../engine/README.md);
             the marker itself is engine-agnostic.
```

```
RUN_PAPER(runId: string)
  category:  Action
  form:      [RUN_PAPER] <runId>
  requires:  the referenced runs row is validated
             desk has no active paper session
  effect:    promote the run into a long-lived paper session
             (see ./PAPER_LIFECYCLE.md for the state machine)
  postcond:  paperSessions row exists in `pending`
  branches:
             - launched           → paper widget visible on desk header
             - rejected_no_validation → refusal comment names PROPOSE_VALIDATION
             - rejected_active_session → refusal comment names the existing session
  user_next_action (per rule #15):
             launched                  → desk header surfaces the live paper widget
             rejected_no_validation    → "Validate this run first via [PROPOSE_VALIDATION] before promoting to paper."
             rejected_active_session   → "Stop the existing paper session before starting a new one."
  notes:     paper sessions leave the turn-based lifecycle entirely;
             observer turns and reconciliation are owned by PAPER_LIFECYCLE.md.
```

```
EXPERIMENT_TITLE(title: string)  // ≤ 8 words
  category:  Action
  form:      [EXPERIMENT_TITLE] <title>
  requires:  experiment.number ≠ 1   // first experiment is permanently `Baseline`
  effect:    update experiments.title
  postcond:  experiment has a human title
  branches:  - applied / - ignored_baseline
  user_next_action: none — metadata-only marker, never a turn boundary
  notes:     rides along on whatever turn it appears in; no retrigger of its own.
```

### No-marker turn (terminal)

A turn that emits no markers is the **terminal state** of the turn cycle. The server saves the comment, emits `agent.done`, and stops. No system comment, no retrigger.

This is intentional: a turn that emits markers wants the server to advance the lifecycle; a turn that emits none wants the user back in the loop. There is no "default action" the server invents on the agent's behalf.

**Per rule #15 (no user dead-ends)**, the UI must make the "your turn" state visible — e.g. an empty composer focus, an explicit "awaiting your reply" affordance on the desk header, or a quiescent indicator. The terminal turn never silently pauses without telling the user it is their move.

## Proposal markers

Every proposal marker has the same shape: parse → attach `pendingProposal` → end the turn. The differences are in the `on approve` step.

**Per rule #15 (no user dead-ends)**, every proposal marker must satisfy two UI invariants:
1. The Approve/Reject buttons on the comment must explain what each choice does (e.g. cache-hit copy on `PROPOSE_DATA_FETCH`).
2. While any `pendingProposal` is unresolved, the desk header surfaces a persistent "1 pending decision" indicator so the user cannot scroll past the buttons unaware.

If the user never decides, the lifecycle pauses, but the indicator from (2) keeps the next move visible — silence is never a dead-end.

```
PROPOSE_DATA_FETCH(proposal: {
  exchange, pairs, timeframe, days, tradingMode, rationale
})
  category:  Proposal
  form:      [PROPOSE_DATA_FETCH]\n{...json...}\n[/PROPOSE_DATA_FETCH]
  requires:  — (dispatch-level: none)
  effect:    parse JSON body, attach pendingProposal to the agent comment
  on approve:
             cache hit  → link desk_datasets
             cache miss → engineAdapter.downloadData(proposal),
                          insert/extend the global datasets row, link
             post "Downloaded…" / "Already cached…" system comment
             retrigger
  postcond:  desk has ≥1 desk_datasets link covering the requested range
             // matches RUN_BACKTEST.requires
  branches:
             - approve+cache_hit  → instant link, no download
             - approve+cache_miss → download container, then link
             - reject             → recovery comment, agent re-proposes or stops
             - ignore             → header indicator persists
  user_next_action (per rule #15):
             approve+cache_hit  → "Already cached — instant link" copy on the button itself
             approve+cache_miss → progress indicator + "Downloaded …" comment afterwards
             reject             → system comment "Data is required to backtest. The agent
                                  will propose again, or you can request a different
                                  dataset by replying."
             ignore             → desk header shows "1 pending decision" badge
  notes:     prompt-level rule #13 forces this to be the agent's *first* response on a
             brand-new desk (no code, no RUN_BACKTEST). If the agent skips it, the next
             turn is caught by RUN_BACKTEST.refusal. Mid-lifecycle top-ups have no guard
             — the agent may propose freely for additional pairs / timeframes / windows.
             engineAdapter.downloadData is engine-specific (Freqtrade CLI, Nautilus
             catalog ingest, generic agent-authored download.{py,ts,js}); the marker
             does not care which engine.
```

```
PROPOSE_VALIDATION()
  category:  Proposal
  form:      [PROPOSE_VALIDATION]
  requires:  ≥1 runs row exists
  effect:    attach pendingProposal
  on approve:
             dispatch a Risk Manager turn against the latest run
             (see ./ROLES.md)
             retrigger analyst with the verdict embedded
  postcond:  RM verdict comment exists
  branches:
             - approve → RM turn dispatched, verdict appears, analyst retriggered
             - reject  → recovery comment ("validation skipped, you can re-request anytime")
             - ignore  → header indicator persists
  user_next_action (per rule #15):
             approve → progress indicator while RM thinks
             reject  → system comment "Validation skipped. Reply 'validate' to re-request."
             ignore  → desk header "1 pending decision" badge
  notes:     this is the only path that wakes the Risk Manager.
             Whether the proposal originated from the analyst's own anomaly detection
             or from a user comment asking for validation is upstream context — at the
             protocol level both collapse to the same flow.
```

```
PROPOSE_NEW_EXPERIMENT(title: string)
  category:  Proposal
  form:      [PROPOSE_NEW_EXPERIMENT] <title>
  requires:  — (the agent is *prompt-instructed* to only propose this when the current
              hypothesis is settled, never for routine parameter tuning)
  effect:    attach pendingProposal
  on approve:
             create new experiments row, switch context
             retrigger
  postcond:  new experiment is current
  branches:  - approve → new experiment switched in / - reject → noop / - ignore → badge
  user_next_action (per rule #15):
             approve → header shows the new experiment as current
             reject  → system comment "Staying in the current experiment."
             ignore  → desk header "1 pending decision" badge
```

```
PROPOSE_COMPLETE_EXPERIMENT()
  category:  Proposal
  form:      [PROPOSE_COMPLETE_EXPERIMENT]
  requires:  —
  effect:    attach pendingProposal
  on approve:
             mark the experiment complete
             (no retrigger)
  postcond:  experiment is closed
  branches:  - approve → experiment closed / - reject → noop / - ignore → badge
  user_next_action (per rule #15):
             approve → system comment names next move ("Start a new experiment or close the desk.")
             reject  → system comment "Continuing this experiment."
             ignore  → desk header "1 pending decision" badge
```

```
PROPOSE_GO_PAPER(runId: string)
  category:  Proposal
  form:      [PROPOSE_GO_PAPER] <runId>
  requires:  the referenced runs row is validated
  effect:    attach pendingProposal
  on approve:
             same effect as RUN_PAPER(runId)
  postcond:  paperSessions row exists in `pending`
  branches:  - approve → paper widget visible / - reject → noop / - ignore → badge
  user_next_action (per rule #15):
             approve → header surfaces live paper widget (same as RUN_PAPER.launched)
             reject  → system comment "Paper trading not started. Approve later when ready."
             ignore  → desk header "1 pending decision" badge
```

## Reading the chain

Trace the lifecycle by matching `postcond` to `requires`:

- `PROPOSE_DATA_FETCH.postcond` (≥1 desk_datasets link) → `RUN_BACKTEST.requires`
- `RUN_BACKTEST.postcond` (runs row exists) → `PROPOSE_VALIDATION.requires`, `PROPOSE_GO_PAPER.requires`
- `PROPOSE_GO_PAPER.postcond` / `RUN_PAPER.postcond` (paperSessions row) → leaves into `PAPER_LIFECYCLE.md`

There is no global state machine — only signatures lining up across turns. Adding a new marker means defining its `requires` and `postcond`; the chain falls out automatically wherever those facts already appear in the current set.

## Failure handling

There is **no automatic retry**. If a marker's effect fails, the run/turn is marked `failed` and the lifecycle stops — the server does not re-dispatch the same marker, and it does not advance to a downstream marker.

- **`PROPOSE_DATA_FETCH` post-Approve download** — error posts a system comment describing the failure and retriggers the agent. The agent decides whether to propose a revised `[PROPOSE_DATA_FETCH]` (different pair naming, shorter window) or give up.
- **`RUN_BACKTEST`** — engine/container error inserts the runs row with `status = failed` and posts the error as a system comment. No analysis turn is auto-dispatched. The next turn is a fresh `triggerAgent` triggered by the failure comment: the agent reads the failure, may edit `strategy.py`, and emits a *new* `[RUN_BACKTEST]` which becomes a new runs row. The failed run is preserved for history, never mutated in place.
- **Agent CLI crash** — turn ends with no comment saved. The user retriggers by commenting again.

Retry is therefore always **agent-driven and user-gated**, never a silent server loop. This keeps the audit trail (runs, comments, commits) linear and prevents runaway Docker spend on a broken strategy.

## Notes

- **Markers are never shown to the user.** Before the agent's response is persisted as a comment, `stripAgentMarkers` removes every bracketed marker block. The UI only ever sees the human-readable text; structured intent is carried separately on the comment's `metadata` (`pendingProposal`) or as a side-effect of the parsed marker (e.g. an inserted `runs` row).
- Proposal markers must appear at the start of a line; action markers tolerate inline placement because they are matched as bracketed blocks.
- Adding a new marker means: (1) teach the agent about it in `prompt-builder.ts`, (2) add a parser in `agent-trigger.ts` (Action) or `triggers.ts` (Proposal), (3) add it to `stripAgentMarkers` so it doesn't leak to the UI, (4) add a function-signature entry to the relevant section above with `requires` / `effect` / `postcond`.
