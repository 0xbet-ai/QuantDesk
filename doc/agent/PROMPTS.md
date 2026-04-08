# Agent Prompts

The text the server feeds to the agent CLI subprocess on every turn. This
file is the **spec**: each prompt template is documented by purpose,
audience, interpolation variables, invariants, and cross-references to the
other agent docs. The implementation lives in `server/src/services/prompts/`
and follows this spec.

Per CLAUDE.md rule #14 (docs are spec, code follows): if the prompt code
diverges from this doc, the default is to fix the code, not the doc.

## Composition

The orchestrator `buildAnalystPrompt(input)` in
`server/src/services/prompt-builder.ts` assembles the analyst prompt by
concatenating these blocks **in this exact order** (each block separated by
a blank line):

1. `analyst.system` — identity, rules, response formatting, experiment
   title, first-run data fetch protocol, proposal markers
2. `analyst.mode-{classic|realtime|generic}` — engine-shaped execution
   instructions for the desk's pinned `strategy_mode`
3. `analyst.failure-escalation` — *conditional*, only when there is a
   recent failure streak in the comment thread
4. `## Desk` — desk context (budget, target, stop-loss, mode, venues)
5. `## Currently working on Experiment` — current experiment header
6. `## Run History` — *conditional*, only when ≥1 run with metrics exists
7. `## Context Summary` — *conditional*, memory summaries injected ahead
   of raw comments (per `./MEMORY.md`)
8. `## Conversation` — full thread on first run, latest user message only
   on resume

The Risk Manager flow uses a single block, `risk-manager.system`, with no
mode-specific composition.

## Templates

### `analyst.system`

**Purpose:** identify the agent as the Analyst, set tone, list the global
rules every turn must follow, document the marker shapes the analyst is
expected to emit, and codify the rule #13 first-run data-fetch protocol.

**File:** `server/src/services/prompts/analyst-system.ts`

**Audience:** Claude / Codex CLI subprocess.

**Interpolation:** none — pure constant string.

**Invariants:**

- English source text only (rule #1) — agent is told to *respond* in the
  user's language but the prompt itself is English.
- "Do not echo prior conversation messages" anti-repeat clause.
- Markers are **named, not redefined**: the prompt mentions
  `[PROPOSE_DATA_FETCH]`, `[RUN_BACKTEST]`, `[BACKTEST_RESULT]`,
  `[DATASET]`, `[EXPERIMENT_TITLE]`, `[PROPOSE_*]` by name and points the
  agent at this block for the actual emit shape. The protocol-level glossary
  lives in `./MARKERS.md` — never duplicate marker schemas across files.
- Path A (server-side `[PROPOSE_DATA_FETCH]`) is **always tried first** on a
  brand-new desk. The prompt explicitly forbids inferring Path A
  unsupportedness from the agent's training data — engine support evolves,
  empirical discovery is required.
- Path B (agent-side fetcher → `[DATASET]`) is documented as the fallback
  *after* a real Path A failure system comment in the experiment's history.

### `analyst.mode-classic`

**Purpose:** teach the agent how the `classic` strategy_mode works (engine
class, required entrypoints, config keys, the two data-acquisition paths,
the `[RUN_BACKTEST]` and `[RUN_PAPER]` request shape).

**File:** `server/src/services/prompts/mode-classic.ts`

**Interpolation:** none currently. (`desk` is in scope but the block does
not use it; if a future field is needed, add an `interpolation:` line here
and the implementation must follow.)

**Invariants:**

- Engine proper names are allowed *only* in this block — it is the
  designated leakage point per the spec hierarchy. Reason: the agent has to
  know which API surface to code against (a `Freqtrade IStrategy` subclass
  has a fixed contract). Other parts of the prompt must NOT name engines.
- "Path A → Path B" data acquisition framing is identical across all three
  mode blocks (only the engine-specific details differ). Keeping the prose
  parallel makes drift easy to spot in PR review.
- `[RUN_BACKTEST]` / `[RUN_PAPER]` are documented by name with the exact
  block format. Marker shapes themselves are owned by `./MARKERS.md`.

### `analyst.mode-realtime`

**Purpose:** same role as `mode-classic` but for the `realtime` mode
(event-driven, tick-level engine).

**File:** `server/src/services/prompts/mode-realtime.ts`

**Interpolation:** none.

**Invariants:** same engine-name leakage allowance and `[RUN_*]` shape
contract as `mode-classic`. Parallel structure required.

### `analyst.mode-generic`

**Purpose:** generic-engine fallback. The agent runs scripts on the host
(no managed container) and must produce a `[BACKTEST_RESULT]` block.

**File:** `server/src/services/prompts/mode-generic.ts`

**Interpolation:** none.

**Invariants:**

- Paper trading is **explicitly disallowed** on generic desks — the prompt
  must tell the agent to never emit `[PROPOSE_GO_PAPER]` here.
- Backtest output contract: stdout JSON wrapped in `[BACKTEST_RESULT] …
  [/BACKTEST_RESULT]`.

### `analyst.failure-escalation`

**Purpose:** persistence pressure injected into the analyst prompt when the
tail of the comment thread shows consecutive failure system comments.
Implements the ralph-loop pattern referenced in `./MARKERS.md` failure
handling.

**File:** `server/src/services/prompts/failure-escalation.ts`

**Interpolation:** `{ streak: number }`.

**Conditional:** only when `streak > 0`. When `streak === 0`, the function
returns an empty string and the orchestrator omits the section entirely so
a normal turn looks unchanged.

**Invariants:**

- Marker-agnostic: any system comment whose body matches the failure
  pattern counts, regardless of which lifecycle stage produced it
  (data-fetch, backtest, validation, etc.).
- The "fundamentally different approach, not a one-character tweak" clause
  is the core anti-loop guard. PR review should not weaken it.
- Bare-acknowledgment language ("OK", "Sorry", "Understood", etc.) is
  explicitly enumerated in **multiple natural languages** because Claude
  tends to slide into Korean/Japanese under pressure.
- Streak detection lives in the same file as a pure helper
  (`countRecentFailureStreak`) so the implementation and the spec live
  together.

### `risk-manager.system`

**Purpose:** identify the agent as the Risk Manager, list the desk
constraints, present the run metrics to validate, and demand the verdict
marker at the end of the response.

**File:** `server/src/services/prompts/risk-manager.ts`

**Interpolation:** `{ desk: DeskContext, runResult: { metrics: MetricEntry[] } }`.

**Invariants:**

- The verdict marker (`[RM_APPROVE]` or `[RM_REJECT] <reason>`) is
  **mandatory** — the prompt explicitly says "End your response with
  exactly one of the following lines". Without it the verdict is
  informational and `[RUN_PAPER]` will refuse, so the prompt must keep this
  language strict.
- The RM has no mode block — it operates against a `runResult`, not a
  `desk.strategyMode`-shaped engine.
- The RM has no failure escalation — Risk Manager turns are short-form
  validation passes; they do not loop on failure the way analyst turns do.

## Helper utilities (not prompt content)

These live alongside the prompt blocks in `server/src/services/prompts/`
or in `prompt-builder.ts`. They are not prompt text but they shape what
gets injected:

- `estimateTokens(text)` — rough char/4 token estimate.
- `trimCommentsToTokenBudget(comments, budget)` — drops oldest comments
  until the running token count fits a budget. Used to bound the
  `## Conversation` section on first run.
- `countRecentFailureStreak(comments)` — drives `analyst.failure-escalation`.

## Adding a new prompt block

1. Add a section to this file with `Purpose / File / Audience /
   Interpolation / Invariants`.
2. Create the corresponding file under `server/src/services/prompts/`
   exporting a `build…Block(input?)` function.
3. Wire it into `buildAnalystPrompt` (or `buildRiskManagerPrompt`) at the
   correct position in the composition order above.
4. If the block adds a new interpolation variable, update
   `AnalystPromptInput` (or the relevant input interface) in
   `server/src/services/prompts/types.ts`.

## Anti-patterns

- **Engine proper names outside `mode-*` blocks.** Rule #6 says the engine
  is internal; the prompt may name engines only inside a `mode-*` block
  because the agent has to code against that engine's API surface. Naming
  Freqtrade or Nautilus in `analyst.system`, `failure-escalation`, or any
  shared block is a violation.
- **Marker schemas duplicated.** A marker's exact JSON shape lives in one
  place (`./MARKERS.md` for the spec, `packages/shared/src/agent-markers.ts`
  for the parser). Prompt blocks may reference markers by name and show a
  *single* representative example each, but they must not become a second
  schema source of truth.
- **Venue-specific guidance baked into the prompt.** "Hyperliquid does not
  support OHLCV via Freqtrade" is a fact the agent should discover
  empirically per session, not a constant baked into the prompt — engine
  support evolves and the prompt should stay venue-agnostic. Path A → Path B
  is the protocol; the agent runs the experiment.
