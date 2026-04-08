# Mock agent fixtures

Deterministic docker-based stand-in for the real Claude/Codex agent.
Activate from the server env:

```bash
MOCK_AGENT=1 pnpm dev
```

This swaps `server/src/services/agent-trigger.ts`'s adapter to the
`MockAdapter` in `packages/adapters/src/mock/`, which spawns a pinned
`python:3.11-slim` container and runs a scenario script from this
directory on every turn. The script reads the full prompt on stdin and
emits plain text + optional marker blocks on stdout, exactly like the
real CLI.

**Purpose**: exercise the server dispatch and UI rendering pipeline
with deterministic input. It is NOT a replacement for live agent
testing — the dispatcher is a stateless keyword matcher and cannot
simulate real conversational reasoning (see "Limitations" below).

## Active scenario

Edit `packages/adapters/src/mock/active-scenario.ts`:

```ts
export const ACTIVE_SCENARIO = "dispatch.py";
```

Or override per-invocation with `MOCK_SCENARIO=<file.py> pnpm dev`.

## dispatch.py — keyword dispatcher

The default scenario. Parses the most recent `[user] …` line from the
prompt (server pipes the whole prompt via stdin) and fires the matching
action marker directly. No ask-then-confirm: the real conversational
approval flow (CLAUDE.md rule #15) only works with a live agent.

### Keyword table

Type the keyword into the experiment comment box. Matching is
case-insensitive and substring-based — whatever you type wins as long
as the keyword is contained in the user message.

| Keyword | Action | Server effect |
|---|---|---|
| `dataset` | `[DATASET]` | Inserts a `datasets` row + desk link for a fake BTC/USDT 1h 180d cache entry. No download. Only meaningful in generic/realtime modes where the agent brings its own data. |
| `backtest` | `[RUN_BACKTEST]` | Runs the backtest against an already-registered dataset. **Requires a successful `data` run first** — otherwise the server refuses with the rule #12 "no dataset" error. Mock engine returns fake metrics and retrigger posts "Backtest Run #N completed". |
| `data` / `fetch` | `[DATA_FETCH]` | Fires `executeDataFetch`. Mock mode skips the real freqtrade container and writes fake OHLCV CSV files into the shared cache. `executeDataFetch` inserts the `datasets` row, creates the `desk_datasets` link, posts "(mock) Downloaded …", and retriggers — satisfying rule #12 for a later `backtest`. |
| `result` / `metric` | `[BACKTEST_RESULT]` | Posts a normalized metrics block (total_return, sharpe, max_drawdown, n_trades). |
| `title` / `rename` | `[EXPERIMENT_TITLE]` | Cosmetic rename of the current experiment (skipped for experiment #1 which is pinned to "Baseline"). |
| `validate` / `validation` | `[VALIDATION]` | Wakes the Risk Manager session for a verdict turn. |
| `new experiment` / `new exp` | `[NEW_EXPERIMENT]` | Closes the current experiment, opens a new one with a fixed title. |
| `complete` / `close` | `[COMPLETE_EXPERIMENT]` | Marks the current experiment as completed. |
| `paper` | `[GO_PAPER]` | Promotes the latest run to paper trading (server-side handler is still a stub). |
| `slow` | none | 15-second silent stretch in the middle of a turn. Tests that the live TurnCard stays mounted during idle streams. |
| `fail` / `error` | none, exit 1 | Emits a line to stderr and exits non-zero. Tests the failed-turn card lifecycle. |
| (anything else) | none | Prints the keyword help table and ends the turn cleanly. |

### Keyword precedence

Keywords are checked in this order so substrings never override
specific matches:

1. `dataset`
2. `backtest`
3. `data` / `fetch`
4. `result` / `metric`
5. `title` / `rename`
6. `validate` / `validation`
7. `new experiment` / `new exp`
8. `complete` / `close`
9. `paper`
10. `slow`
11. `fail` / `error`

### Dataset state sniff

Once a data fetch has run successfully, the dispatcher detects the
`(mock) Downloaded …` / `Reusing existing dataset` / `Dataset
registered and linked to this desk` lines in the prompt's `[system]`
section and refuses to fire another `DATA_FETCH`, emitting "Dataset is
already registered. Type `backtest` to run the baseline." instead.
This breaks the retrigger loop that would otherwise repeat the fetch
on every subsequent `data` command.

## Other scenarios (fixed, non-interactive)

Each file emits a hardcoded sequence and ignores the user input. Pick
one via `MOCK_SCENARIO=<file>`:

- `happy.py` — plain-text paragraphs spaced 10 seconds apart. Exercises
  the TurnCard streaming display and "completed" transition.
- `slow.py` — 15-second silent stretch in the middle. Checks that the
  live TurnCard stays mounted during idle output.
- `fail.py` — emits a couple of lines then exits 1 with stderr.
  Exercises the "failed" terminal card lifecycle.
- `marker_*.py` — one file per marker. Emits a small preamble and then
  exactly that marker. Handy for isolating UI rendering of a specific
  action.

## Expected workflow (classic mode)

The mock dispatcher is stateless and direct, but it respects the same
rule #12 precondition the real server enforces: you must have a
dataset linked to the desk before you can run a backtest. Type the
keywords in this order:

1. `data` — fires `[DATA_FETCH]`. `executeDataFetch` writes a fake
   OHLCV CSV into the shared cache, inserts the `datasets` row, links
   it to this desk, and posts a confirmation comment. Rule #12 is now
   satisfied.
2. `backtest` — fires `[RUN_BACKTEST]`. The server's mock engine
   returns fake metrics and posts "Backtest Run #N completed".
3. Optional: `result`, `validate`, `new experiment`, `complete`,
   `paper`, `title` — exercise the remaining markers.

Typing `backtest` on a fresh desk without first typing `data` will
correctly hit the rule #12 refusal ("Cannot run backtest: no dataset
has been registered for this desk…"). That is the expected behaviour
for debugging the refusal path.

## Limitations

- **No conversational flow.** The mock dispatcher is a stateless regex
  matcher and cannot see its own previous messages in the resume
  prompt. It cannot ask-then-wait like the real agent. To test the
  conversational UX (rule #15), run with a live agent — `MOCK_AGENT`
  off, valid `AGENT_MODEL`, etc.
- **Mocked downloads.** `data-fetch.ts` has a `MOCK_AGENT=1` branch
  that skips the real freqtrade container. The mock writes a small
  synthetic OHLCV CSV file into the shared cache so the dataset
  preview endpoint has something to read. Real venues are never
  contacted.
- **Mocked backtests.** `agent-trigger.ts` has a matching branch that
  returns a fake `NormalizedResult` instead of spawning a freqtrade
  container. `strategy.py` is not read, the engine is not invoked, and
  the metrics are deterministic.
- **Persistent fake sessionId.** `MockAdapter.parseOutputStream`
  returns a stable fake session id so every turn after the first uses
  the `isResume` prompt branch. This is required so the dispatcher can
  see `[system]` comments (the non-resume branch filters them out).
- **`MockAdapter` skips the dead-end guard.** `agent-trigger.ts`
  bypasses the rule #14 dead-end guard when `MOCK_AGENT=1` because
  mock scenarios intentionally emit no markers in the default path and
  would otherwise be caught in a rescue loop.

## Common gotchas

- **Multiple turn cards after a single keyword.** The server retriggers
  the agent after most markers (DATA_FETCH success, RUN_BACKTEST
  completion, VALIDATION handoff, NEW_EXPERIMENT creation). Each
  retrigger is a new turn. The dispatcher's job is to fall through to
  the default help text on retriggers so the chain stops cleanly —
  look for "Dataset is already registered" or "Type a keyword …" on
  the last card.
- **Desk-creation auto-trigger.** When a desk is created, the server
  triggers the agent once with no user message. The dispatcher
  currently prints the help table in that case (no marker fires).
  Type a keyword to kick off an actual action.
- **`dataset` vs `data` substring.** `"data" in "dataset"` is true, so
  the DATASET route is deliberately checked before the DATA_FETCH
  route. If you add new keywords, keep more-specific ones first.
