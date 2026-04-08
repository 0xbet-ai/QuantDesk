# Agent Turn Lifecycle

How a single agent turn is dispatched, what branches the server takes after parsing the agent's output, and how turns chain together across a desk's lifecycle. This document covers the **turn-based backtest cycle**; for long-running paper trading sessions (which have no turn end) see `./PAPER_LIFECYCLE.md`. For the underlying CLI execution mechanics see `./TURN.md`. For the marker glossary see `./MARKERS.md`.

`triggerAgent(experimentId)` in `server/src/services/agent-trigger.ts:168` is the single entry point for every agent turn. After the CLI subprocess returns, the server inspects `result.resultText` for marker blocks and dispatches the following branches. Branches are **not** mutually exclusive — they are checked in order within the same turn (the rule #13 refusal is the only early `return`).

The flow is best understood as a **lifecycle with three stages**, each driven by a separate `triggerAgent` turn. Within a single turn the server checks all marker branches, but across turns the desk progresses in this order: data fetch → strategy + backtest → analysis. The diagram below is organised by stage rather than by `if` statement.

```mermaid
%%{init: {'flowchart': {'nodeSpacing': 55, 'rankSpacing': 65, 'htmlLabels': true}, 'themeVariables': {'fontSize': '17px'}}}%%
flowchart TD
    Start(["new comment on experiment"]) --> Trigger["triggerAgent(expId)"]
    Trigger --> Ctx["load context · run agent CLI<br/>git commit if workspace changed"]
    Ctx --> Parse{"which markers in<br/>agent resultText?"}

    %% ── STAGE 1: data fetch lifecycle ──
    subgraph S1["Stage 1 — Data fetch (rule #13)"]
        direction TB
        P1["#91;PROPOSE_DATA_FETCH#93;<br/>attach pendingProposal<br/>to agent comment"]
        P2(["wait for user Approve"])
        PL["resolve dataset<br/>(cache lookup, incremental fetch, validate)<br/>see desk/STORAGE.md"]
        P4["post 'Downloaded...' /<br/>'Already cached...' system comment"]
        P1 --> P2 --> PL --> P4
    end

    %% ── STAGE 2: backtest lifecycle ──
    subgraph S2["Stage 2 — Backtest"]
        direction TB
        B0{"dataset exists<br/>for desk?"}
        B1["refuse: post rule #13<br/>system comment · return"]
        B2["engineAdapter.runBacktest()<br/>inside Docker<br/>(classic / realtime / generic)"]
        B3["insert Run row"]
        B4["post backtest result<br/>system comment"]
        B0 -- no --> B1
        B0 -- yes --> B2 --> B3 --> B4
    end

    %% ── STAGE 3: analysis / metadata ──
    subgraph S3["Stage 3 — Analysis &amp; metadata"]
        direction TB
        A1["agent: plain-text analysis<br/>(no markers)"]
        A2["#91;EXPERIMENT_TITLE#93;<br/>update experiments.title<br/>(see MARKERS.md)"]
        A3["#91;DATASET#93;<br/>register dataset<br/>(see desk/STORAGE.md)"]
        A4["#91;PROPOSE_VALIDATION#93;<br/>dispatch Risk Manager turn<br/>against latest run"]
        A5["#91;PROPOSE_NEW_EXPERIMENT#93;<br/>render Accept / Decline<br/>on agent comment"]
        A6["#91;PROPOSE_COMPLETE_EXPERIMENT#93;<br/>render Accept / Decline<br/>on agent comment"]
    end

    Parse -- "#91;PROPOSE_DATA_FETCH#93;" --> P1
    Parse -- "#91;RUN_BACKTEST#93;" --> B0
    Parse -- "#91;EXPERIMENT_TITLE#93;" --> A2
    Parse -- "#91;DATASET#93;" --> A3
    Parse -- "#91;PROPOSE_VALIDATION#93;" --> A4
    Parse -- "#91;PROPOSE_NEW_EXPERIMENT#93;" --> A5
    Parse -- "#91;PROPOSE_COMPLETE_EXPERIMENT#93;" --> A6
    Parse -- "no markers" --> A1

    %% retrigger edges showing the stage cycle
    P4 -. "retrigger" .-> Trigger
    B4 -. "retrigger" .-> Trigger
    A4 -. "retrigger after verdict" .-> Trigger
    A1 --> Strip
    A2 --> Strip
    A3 --> Strip
    A4 --> Strip
    A5 --> Strip
    A6 --> Strip
    B1 --> Strip
    Strip["stripAgentMarkers<br/>save agent comment"] --> Done(["agent.done event"])
```

**How to read this:**

- **Stage 1 (data fetch)** is the gate. A brand-new desk must traverse this before anything else — the agent proposes, the user approves, the server downloads, and only then does a `datasets` row exist.
- **Stage 2 (backtest)** can only succeed once Stage 1 has produced a dataset. The `dataset exists?` check at `B0` enforces this; without a dataset the server posts a refusal and returns, kicking the agent back to Stage 1.
- **Stage 3 (analysis)** is the terminal stage of any turn. After a backtest result comment is posted, the recursive `triggerAgent` lands here: the agent reads the result and replies with plain text. `[EXPERIMENT_TITLE]` and `[DATASET]` are side-channel metadata markers that can ride along on any turn. `[PROPOSE_VALIDATION]` dispatches a Risk Manager turn against the latest run and retriggers the Analyst with the verdict. `[PROPOSE_NEW_EXPERIMENT]` and `[PROPOSE_COMPLETE_EXPERIMENT]` attach Accept/Decline controls to the agent comment and wait for the user — they do not mutate state until the user acts.
- **Recursion** (`P4 → Trigger`, `B4 → Trigger`) is what stitches the stages together across turns. Each retrigger is a fresh `triggerAgent` invocation with the new system comment as input.
- **Stage 1 spans more than one HTTP request.** The agent turn that emits `[PROPOSE_DATA_FETCH]` ends as soon as the `pendingProposal` is saved on the comment; the server does not block on user approval. Approval (or rejection) arrives later as a separate user-initiated request, and that is what actually triggers the download → validate → datasets row → re-trigger chain. If the user closes the tab and never decides, the lifecycle simply pauses forever in `P2`.

## Intended first-desk happy path

For a brand-new desk with no strategy code and no registered dataset, rule #13 requires the agent to propose a data fetch first and wait for user approval before writing any code or running a backtest.

```mermaid
%%{init: {'themeVariables': {'fontSize': '18px'}, 'sequence': {'actorMargin': 80, 'messageFontSize': 16}}}%%
sequenceDiagram
    autonumber
    actor U as User
    participant S as Server
    participant A as Agent CLI
    participant E as Engine (Docker)

    Note over U,E: Rule #13 — agent-proposed, user-approved data fetch

    U->>S: first comment
    S->>A: triggerAgent (turn 1)
    A-->>S: [PROPOSE_DATA_FETCH] only<br/>(no code, no RUN_BACKTEST)
    S-->>U: comment with Approve / Reject buttons

    U->>S: Approve
    S->>S: cache lookup (exchange, pairs, timeframe)
    alt full hit (cached range covers request)
        S->>S: link desk_datasets
        S->>S: post "Already cached..." system comment
    else partial hit or miss
        S->>E: download-data container (missing range)
        E-->>S: candles on disk
        S->>S: validate downloaded data
        S->>S: insert or extend datasets row + desk_datasets link
        S->>S: post "Downloaded..." system comment
    end
    S->>A: triggerAgent (turn 2)
    A-->>S: writes strategy.py + [RUN_BACKTEST]

    S->>E: engineAdapter.runBacktest
    E-->>S: NormalizedResult
    S->>S: insert Run row
    S->>S: post backtest result system comment
    S->>A: triggerAgent (turn 3, recursive)
    A-->>S: analysis comment (no markers)
    S-->>U: render results + analysis
```

## Failure handling

There is **no automatic retry** anywhere in the lifecycle. If a stage fails, the run/turn is marked `failed` and the lifecycle stops — the server does not re-dispatch the same work on its own, and it does **not** advance to the next stage. A failure in Stage 1 means Stage 2 never runs; a failure in Stage 2 means Stage 3 never runs.

- **Stage 1 (data fetch)** — a download error posts a system comment describing the failure and retriggers the agent. The agent decides whether to propose a revised `[PROPOSE_DATA_FETCH]` (e.g. different pair naming, shorter window) or give up. The user can also simply comment again to nudge it.
- **Stage 2 (backtest)** — an engine/container error inserts the Run row with `status = failed` and posts the error as a system comment. No analysis turn is auto-dispatched. The next turn is a fresh `triggerAgent` triggered by the failure comment: the agent reads the failure, may edit `strategy.py`, and emits a **new** `[RUN_BACKTEST]` which becomes a new Run row. The failed run is preserved for history, never mutated in place.
- **Stage 3 (analysis)** — if the agent CLI itself crashes mid-turn, the turn ends with no comment saved. The user retriggers by commenting again.

Retry is therefore always **agent-driven and user-gated**, never a silent server loop. This keeps the audit trail (runs, comments, commits) linear and prevents runaway Docker spend on a broken strategy.
