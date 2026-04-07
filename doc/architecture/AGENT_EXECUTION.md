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

## Trigger Branching (single turn)

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
        P3["server: download-data container<br/>insert datasets row"]
        P4["post 'Downloaded...'<br/>system comment"]
        P1 --> P2 --> P3 --> P4
    end

    %% ── STAGE 2: backtest lifecycle ──
    subgraph S2["Stage 2 — Backtest"]
        direction TB
        B0{"dataset exists<br/>for desk?"}
        B1["refuse: post rule #13<br/>system comment · return"]
        B2["engineAdapter.runBacktest()<br/>inside Docker (classic / realtime)"]
        B3["insert Run row"]
        B4["post #91;BACKTEST_RESULT#93;<br/>system comment"]
        BG["#91;BACKTEST_RESULT#93; from agent<br/>(generic path) · insert Run row"]
        B0 -- no --> B1
        B0 -- yes --> B2 --> B3 --> B4
    end

    %% ── STAGE 3: analysis / metadata ──
    subgraph S3["Stage 3 — Analysis &amp; metadata"]
        direction TB
        A1["agent: plain-text analysis<br/>(no markers)"]
        A2["#91;EXPERIMENT_TITLE#93;<br/>(only if exp.num != 1)"]
        A3["#91;DATASET#93;<br/>insert datasets row"]
    end

    Parse -- "#91;PROPOSE_DATA_FETCH#93;" --> P1
    Parse -- "#91;RUN_BACKTEST#93;<br/>classic / realtime" --> B0
    Parse -- "#91;BACKTEST_RESULT#93;<br/>generic" --> BG
    Parse -- "#91;EXPERIMENT_TITLE#93;" --> A2
    Parse -- "#91;DATASET#93;" --> A3
    Parse -- "no markers" --> A1

    %% retrigger edges showing the stage cycle
    P4 -. "retrigger" .-> Trigger
    B4 -. "retrigger" .-> Trigger
    BG --> Strip
    A1 --> Strip
    A2 --> Strip
    A3 --> Strip
    B1 --> Strip
    Strip["stripAgentMarkers<br/>save agent comment"] --> Done(["agent.done event"])
```

**How to read this:**

- **Stage 1 (data fetch)** is the gate. A brand-new desk must traverse this before anything else — the agent proposes, the user approves, the server downloads, and only then does a `datasets` row exist.
- **Stage 2 (backtest)** can only succeed once Stage 1 has produced a dataset. The `dataset exists?` check at `B0` enforces this; without a dataset the server posts a refusal and returns, kicking the agent back to Stage 1.
- **Stage 3 (analysis)** is the terminal stage of any turn. After a backtest result comment is posted, the recursive `triggerAgent` lands here: the agent reads the result and replies with plain text. `[EXPERIMENT_TITLE]` and `[DATASET]` are side-channel metadata markers that can ride along on any turn.
- **Recursion** (`P4 → Trigger`, `B4 → Trigger`) is what stitches the stages together across turns. Each retrigger is a fresh `triggerAgent` invocation with the new system comment as input.

### Intended first-desk happy path

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
    S->>E: download-data container
    E-->>S: candles on disk
    S->>S: insert datasets row
    S->>S: post "Downloaded..." system comment
    S->>A: triggerAgent (turn 2)
    A-->>S: writes strategy.py + [RUN_BACKTEST]

    S->>E: engineAdapter.runBacktest
    E-->>S: NormalizedResult
    S->>S: insert Run row
    S->>S: post [BACKTEST_RESULT] system comment
    S->>A: triggerAgent (turn 3, recursive)
    A-->>S: analysis comment (no markers)
    S-->>U: render results + analysis
```

### Known fragile spots

- **Recursive re-trigger on both success and failure.** `[RUN_BACKTEST]` re-triggers the agent on success (`agent-trigger.ts:388`) and on failure (`agent-trigger.ts:400`). If the agent keeps emitting `[RUN_BACKTEST]` after a failure, the loop has no explicit budget — only the rule #13 refusal branch returns early.
- **Multiple markers in one reply.** A single agent response containing both `[PROPOSE_DATA_FETCH]` and `[RUN_BACKTEST]` will execute the backtest *and* attach the proposal to the comment, because branches are not mutually exclusive. This is currently prevented only by the prompt, not by a server-side guard.
- **Dataset existence is desk-scoped, not experiment-scoped.** The rule #13 gate (`agent-trigger.ts:312-315`) checks any dataset on the desk. A new experiment inside an existing desk will skip the propose/approve dance entirely if a sibling experiment already registered a dataset.
- **Experiment #1 title is pinned.** The `[EXPERIMENT_TITLE]` marker is ignored when `experiment.number === 1` (`agent-trigger.ts:529`), so the first experiment is permanently labelled `Baseline`.
