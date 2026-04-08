"""Keyword dispatcher (direct action).

Reads the user prompt from stdin and dispatches on the keyword in the
most recent user message. Each keyword maps to exactly one action
marker, emitted directly in the same turn.

Note: a real Claude/Codex agent follows the two-turn conversational
approval pattern (CLAUDE.md rule #15) — ask in plain text, wait, then
emit the marker on the next turn after the user agrees. The mock does
NOT simulate that because it's a stateless regex dispatcher and can't
see its own previous question in the resume prompt. Mock exists to
exercise the server dispatch + UI rendering pipeline with deterministic
input, not to validate conversational reasoning. For conversational UX
testing use a live agent (claude/codex), not MOCK_AGENT=1.
"""

import sys
import time


def emit(text: str, delay: float = 0.4) -> None:
    print(text, flush=True)
    time.sleep(delay)


def block(name: str, body: str) -> None:
    print(f"[{name}]", flush=True)
    print(body, flush=True)
    print(f"[/{name}]", flush=True)


def extract_last_user_message(raw: str) -> str:
    """Pull out the most recent `[user] ...` line from the prompt."""
    last = ""
    for line in raw.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("[user]"):
            last = stripped[len("[user]") :].strip()
    return last


def main() -> int:
    raw = sys.stdin.read() if not sys.stdin.isatty() else ""
    last_user = extract_last_user_message(raw)
    # When there is no user message yet (e.g. the auto-trigger on desk
    # creation), exit silently — no output means no analyst comment,
    # which means no extra TurnCard cluttering the experiment page.
    # The user drives the flow by typing a keyword.
    if not last_user:
        return 0
    prompt = last_user.lower()

    # Dataset state sniff — only match actual system comment lines so
    # instruction prose in the mode blocks cannot trip this. Used to
    # break the data-fetch retrigger loop (the server retriggers the
    # agent after running DATA_FETCH, and on that next turn the prompt
    # has the "(mock) Downloaded …" comment in its [system] lines).
    system_lines = [
        line for line in raw.splitlines() if line.lstrip().startswith("[system]")
    ]
    system_text = "\n".join(system_lines).lower()
    dataset_already_registered = (
        "(mock) downloaded" in system_text
        or "reusing existing dataset" in system_text
        or "dataset registered and linked to this desk" in system_text
    )

    # ── direct keyword routes ────────────────────────────────────────────
    # NOTE: more specific keywords must come BEFORE their substrings.
    # "dataset" contains "data", so the DATASET route must be checked
    # before the DATA_FETCH route. Same for "backtest" containing no
    # ambiguous substring but still ordered early for clarity.

    if "dataset" in prompt:
        emit("Recording the dataset I just downloaded.")
        emit("")
        block(
            "DATASET",
            '{"name":"BTC/USDT 1h 180d",'
            '"exchange":"binance","pairs":["BTC/USDT"],"timeframe":"1h","days":180}',
        )
        return 0

    if "backtest" in prompt:
        emit("Strategy code is ready. Running the baseline backtest now.")
        emit("")
        # No DATASET marker here — rule #12 (desk has ≥1 desk_datasets
        # link before RUN_BACKTEST) is satisfied by a prior successful
        # DATA_FETCH, which already inserts the dataset row and links
        # it to the desk. Typing `backtest` on a fresh desk without
        # first typing `data` will correctly hit the rule #12 refusal.
        block("RUN_BACKTEST", '{"strategyName":"AdxFastdBaseline","entrypoint":"strategy.py"}')
        return 0

    if ("data" in prompt or "fetch" in prompt) and not dataset_already_registered:
        emit("Downloading historical OHLCV for the baseline.")
        emit("")
        block(
            "DATA_FETCH",
            '{"exchange":"binance","pairs":["BTC/USDT"],"timeframe":"1h",'
            '"days":180,"tradingMode":"spot",'
            '"rationale":"Six months of hourly BTC/USDT for the baseline."}',
        )
        return 0

    if ("data" in prompt or "fetch" in prompt) and dataset_already_registered:
        # The retrigger after a successful DATA_FETCH lands here — the
        # prompt already has "(mock) Downloaded …" and the dispatcher
        # must NOT fire another DATA_FETCH. Emit a harmless
        # acknowledgement and end the turn.
        emit("Dataset is already registered. Type `backtest` to run the baseline.")
        return 0

    if "result" in prompt or "metric" in prompt:
        emit("Backtest finished. Posting the normalized result block.")
        emit("")
        block(
            "BACKTEST_RESULT",
            '{"metrics":[{"key":"total_return","label":"Total return",'
            '"value":0.182,"format":"percent","tone":"positive"},'
            '{"key":"sharpe","label":"Sharpe","value":1.41,"format":"number"},'
            '{"key":"max_drawdown","label":"Max drawdown","value":-0.087,'
            '"format":"percent","tone":"negative"},'
            '{"key":"n_trades","label":"Trades","value":47,"format":"number"}]}',
        )
        return 0

    if "title" in prompt or "rename" in prompt:
        emit("Renaming this experiment.")
        emit("[EXPERIMENT_TITLE] ADX+FastD baseline on BTC/USDT 1h")
        return 0

    if "validate" in prompt or "validation" in prompt:
        emit("Handing off to the Risk Manager for validation.")
        emit("[VALIDATION]")
        return 0

    if "new experiment" in prompt or "new exp" in prompt:
        emit("Opening a new experiment with a lower ADX threshold.")
        emit("[NEW_EXPERIMENT] Lower ADX threshold to 20")
        return 0

    if "complete" in prompt or "close" in prompt:
        emit("Closing this experiment.")
        emit("[COMPLETE_EXPERIMENT]")
        return 0

    if "paper" in prompt:
        emit("Promoting the validated run to paper trading.")
        emit("[GO_PAPER] latest")
        return 0

    # ── lifecycle scenarios ──────────────────────────────────────────────
    if "slow" in prompt:
        emit("Pulling up prior runs.")
        emit("Loading dataset metadata...")
        time.sleep(15)
        emit("Done. Continuing analysis.")
        emit("(slow scenario complete)")
        return 0

    if "fail" in prompt or "error" in prompt:
        emit("Attempting to load strategy template...")
        emit("ERROR: template not found", delay=0.2)
        print("traceback: simulated failure", file=sys.stderr, flush=True)
        return 1

    # ── default: brief help, no markers ──────────────────────────────────
    emit("Type a keyword to drive the mock dispatcher:")
    emit("")
    emit("  data / fetch         → fire DATA_FETCH")
    emit("  backtest             → register dataset + fire RUN_BACKTEST")
    emit("  result               → post fake BACKTEST_RESULT metrics")
    emit("  dataset              → register a dataset")
    emit("  title / rename       → rename the experiment")
    emit("  validate             → fire VALIDATION")
    emit("  new experiment       → fire NEW_EXPERIMENT")
    emit("  complete / close     → fire COMPLETE_EXPERIMENT")
    emit("  paper                → fire GO_PAPER")
    emit("")
    emit("Lifecycle tests:")
    emit("  slow                 → 15s silent stretch + resume")
    emit("  fail / error         → exit 1 with stderr")
    return 0


if __name__ == "__main__":
    sys.exit(main())
