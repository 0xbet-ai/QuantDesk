# Agent Markers

The protocol between the agent and the server are a small set of bracketed markers the agent emits in its response. The server greps for them after each agent turn and either takes an action (e.g. run a backtest) or attaches metadata to the agent's comment.

This file is the **glossary**. The authoritative definitions live in the prompt builder and parser code:

- **Definitions** (what the agent is told to emit) — `server/src/services/prompt-builder.ts`
- **Action markers** (parsed and acted on at the end of every turn) — `server/src/services/agent-trigger.ts`
- **Proposal markers** (parsed into pending-proposal metadata on the comment) — `server/src/services/triggers.ts`

Throughout this document, **managed mode** refers to desks whose `strategy_mode` is `classic` or `realtime` — both are handled identically at the marker level (the server maps them to Freqtrade or Nautilus internally). **Generic mode** is the fallback for venues without a managed engine. Marker semantics only ever distinguish managed vs generic, never classic vs realtime.

## Action markers

These cause the server to do something during the same turn the marker appears in.

| Marker | Form | What the server does |
|---|---|---|
| `[RUN_BACKTEST]` | <code>[RUN_BACKTEST]\n{...}\n[/RUN_BACKTEST]</code> with `{strategyName, configFile?}` | **Managed mode only.** Spawn the engine adapter inside Docker, insert a `Run` row, then post `[BACKTEST_RESULT]` as a system comment and re-trigger the agent. Refused with a system comment if no dataset is registered for the desk (rule #13). |
| `[RUN_PAPER]` | `[RUN_PAPER] <runId>` | **Managed mode only.** Start a long-lived paper trading container labelled with `quantdesk.runId` / `quantdesk.engine` / `quantdesk.kind=paper`. |
| `[BACKTEST_RESULT]` | <code>[BACKTEST_RESULT]\n{metrics: [...]}\n[/BACKTEST_RESULT]</code> | **Generic mode only.** The agent runs the backtest itself (host execution) and emits the result. The server parses the JSON and inserts a `Run` row. Managed mode never uses this — the server emits it instead. |
| `[DATASET]` | <code>[DATASET]\n{exchange, pairs, timeframe, dateRange, path}\n[/DATASET]</code> | Insert a `datasets` row for data the agent has downloaded itself. (For the proposal-driven flow see `[PROPOSE_DATA_FETCH]` below.) |
| `[EXPERIMENT_TITLE]` | `[EXPERIMENT_TITLE] <short title, max 8 words>` | Update `experiments.title`. **Ignored when `experiment.number === 1`** — the first experiment of every desk is permanently `Baseline`. |
| `[PROPOSE_DATA_FETCH]` | <code>[PROPOSE_DATA_FETCH]\n{exchange, pairs, timeframe, days, tradingMode, rationale}\n[/PROPOSE_DATA_FETCH]</code> | Attach a `pendingProposal` to the agent's comment so the UI renders Approve / Reject buttons. The agent turn ends here — it does **not** block waiting for the user. The actual download runs in a **separate user-initiated request** when the user clicks Approve, and the agent is then re-triggered by the resulting "Downloaded..." system comment. If the user never approves, no further action happens. **Required first response on a brand-new desk** (rule #13). |

## Proposal markers

These don't trigger server-side actions. They are parsed into structured proposal metadata on the agent's comment so the UI can render an approve/reject affordance for the user.

| Marker | Form | Meaning |
|---|---|---|
| `[PROPOSE_VALIDATION]` | `[PROPOSE_VALIDATION]` | Suggest Risk Manager validation of the latest run. The server parses the marker and routes it into the Risk Manager turn flow described in `doc/agent/ROLES.md`. |
| `[PROPOSE_NEW_EXPERIMENT]` | `[PROPOSE_NEW_EXPERIMENT] <title>` | Suggest splitting work into a new experiment. The agent is instructed to only propose this when the current hypothesis is settled or the direction has clearly changed — never for routine parameter tuning. |
| `[PROPOSE_COMPLETE_EXPERIMENT]` | `[PROPOSE_COMPLETE_EXPERIMENT]` | Suggest marking the current experiment as completed. |
| `[PROPOSE_GO_PAPER]` | `[PROPOSE_GO_PAPER] <runId>` | Suggest promoting a completed backtest run to paper trading. **Forbidden in generic mode** — the prompt instructs the agent not to emit it for generic desks. |

## Notes

- **Markers are never shown to the user.** Before the agent's response is persisted as a comment, `stripAgentMarkers` (`packages/shared/src/agent-markers.ts`) removes every bracketed marker block. The UI only ever sees the human-readable text; structured intent is carried separately on the comment's `metadata` (`pendingProposal`) or as a side-effect of the parsed marker (e.g. an inserted `Run` row).
- Action markers and proposal markers can both appear in the same response. The server checks all branches per turn (the rule #13 dataset gate is the only early `return`).
- Markers must appear at the start of a line for proposal markers; action markers tolerate inline placement because they are matched as bracketed blocks.
- Adding a new marker means: (1) teach the agent about it in `prompt-builder.ts`, (2) add a parser in `agent-trigger.ts` or `triggers.ts`, (3) add it to `stripAgentMarkers` so it doesn't leak to the UI, (4) update this file.
