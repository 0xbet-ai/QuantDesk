"""Keyword dispatcher (conversational approval).

Reads the user prompt from stdin (server pipes the full prompt into the
docker container) and emits either a plain-text question or a direct
action marker, depending on what the user just typed and what context is
already in the prompt.

CLAUDE.md rule #15 makes approval conversational:
 - turn N:   user types a keyword like `data` → dispatcher emits a plain
             text question, no marker, turn ends
 - turn N+1: user replies "yes" (or any affirmative) → dispatcher emits
             the corresponding action marker, server executes it

Priority rules:
 1. If the most recent user message is an affirmative ("yes", "go",
    "ok", "sure", "do it", "proceed") AND an earlier ask is visible in
    the prompt history, fire the execution marker that matches the ask.
 2. Otherwise, route on the keyword in the last user message and emit
    the corresponding *question* — no marker.
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


AFFIRMATIVE = {
    "yes",
    "y",
    "go",
    "ok",
    "okay",
    "sure",
    "do it",
    "proceed",
    "confirm",
    "confirmed",
    "please do",
    "let's go",
    "lets go",
    "approve",
    "approved",
}


def is_affirmative(text: str) -> bool:
    t = text.strip().lower().rstrip(".!")
    if not t:
        return False
    if t in AFFIRMATIVE:
        return True
    # `yes, but ...` / `go ahead and ...` count too — the server lets the
    # agent re-state the parameters on the execution turn.
    for prefix in ("yes", "go", "ok", "okay", "sure", "proceed"):
        if t.startswith(prefix + " ") or t.startswith(prefix + ","):
            return True
    return False


def last_user_messages(raw: str, n: int = 6) -> list[str]:
    """Return the last `n` `[user]` lines in the prompt, most-recent last."""
    out: list[str] = []
    for line in raw.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("[user]"):
            out.append(stripped[len("[user]") :].strip())
    return out[-n:]


def main() -> int:
    raw = sys.stdin.read() if not sys.stdin.isatty() else ""
    users = last_user_messages(raw)
    last_user = users[-1] if users else ""
    prior_users = " ".join(users[:-1]).lower() if len(users) > 1 else ""
    prompt = last_user.lower()

    # Dataset state sniff — only match actual system comment lines so
    # instruction prose in the mode blocks cannot trip this.
    system_lines = [
        line for line in raw.splitlines() if line.lstrip().startswith("[system]")
    ]
    system_text = "\n".join(system_lines).lower()
    dataset_already_registered = (
        "(mock) downloaded" in system_text
        or "reusing existing dataset" in system_text
        or "dataset registered and linked to this desk" in system_text
    )

    # ── affirmative path: execute what was asked in the previous turn ─────
    if is_affirmative(last_user):
        if "data" in prior_users or "fetch" in prior_users:
            emit("Downloading the dataset now.")
            emit("")
            block(
                "DATA_FETCH",
                '{"exchange":"binance","pairs":["BTC/USDT"],"timeframe":"1h",'
                '"days":180,"tradingMode":"spot",'
                '"rationale":"Six months of hourly BTC/USDT for the baseline."}',
            )
            return 0
        if "validate" in prior_users or "validation" in prior_users:
            emit("Handing off to the Risk Manager.")
            emit("[VALIDATION]")
            return 0
        if "new experiment" in prior_users or "new exp" in prior_users:
            emit("Opening a new experiment.")
            emit("[NEW_EXPERIMENT] Lower ADX threshold to 20")
            return 0
        if "complete" in prior_users or "close" in prior_users:
            emit("Closing this experiment.")
            emit("[COMPLETE_EXPERIMENT]")
            return 0
        if "paper" in prior_users:
            emit("Promoting the validated run to paper trading.")
            emit("[GO_PAPER] latest")
            return 0
        # Nothing to execute — fall through to default.

    # ── ask path: user typed a keyword, we ask for confirmation ───────────
    if ("data" in prompt or "fetch" in prompt) and not dataset_already_registered:
        emit("I'd like to pull historical OHLCV before writing strategy code.")
        emit("")
        emit("Proposed dataset:")
        emit("- exchange: binance")
        emit("- pair: BTC/USDT")
        emit("- timeframe: 1h")
        emit("- range: last 180 days")
        emit("- trading mode: spot")
        emit("")
        emit("Rationale: six months of hourly data for an ADX+FastD baseline.")
        emit("")
        emit("OK to proceed, or would you like to adjust any of these? Reply `yes` to start the download.")
        return 0

    if ("data" in prompt or "fetch" in prompt) and dataset_already_registered:
        emit("Dataset is already registered for this desk.")
        emit("Type `backtest` to run the baseline backtest, or `result` to see fake metrics.")
        return 0

    if "backtest" in prompt:
        emit("Strategy code is ready. Running the baseline backtest now.")
        emit("")
        # Register a dataset first so rule #12 (no RUN_BACKTEST before a
        # dataset is linked) does not block the backtest marker. In a
        # real desk this would be a separate turn after DATA_FETCH.
        block(
            "DATASET",
            '{"name":"BTC/USDT 1h 180d",'
            '"exchange":"binance","pairs":["BTC/USDT"],"timeframe":"1h","days":180}',
        )
        emit("")
        block("RUN_BACKTEST", '{"strategyName":"AdxFastdBaseline","entrypoint":"strategy.py"}')
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

    if "dataset" in prompt:
        emit("Recording the dataset I just downloaded.")
        emit("")
        block(
            "DATASET",
            '{"name":"BTC/USDT 1h 180d",'
            '"exchange":"binance","pairs":["BTC/USDT"],"timeframe":"1h","days":180}',
        )
        return 0

    if "title" in prompt or "rename" in prompt:
        emit("Renaming this experiment.")
        emit("[EXPERIMENT_TITLE] ADX+FastD baseline on BTC/USDT 1h")
        return 0

    if "validate" in prompt or "validation" in prompt:
        emit("Baseline metrics look promising. Should I hand this off to the Risk Manager for validation against the desk's risk budget? Reply `yes` to dispatch.")
        return 0

    if "new experiment" in prompt or "new exp" in prompt:
        emit("This run shows ADX threshold may be too high. Would you like me to close this experiment and open a new one focused on a lower ADX threshold? Reply `yes` to proceed.")
        return 0

    if "complete" in prompt or "close" in prompt:
        emit("Three runs have converged on the same Sharpe band and further iteration looks unlikely to move the needle. OK to close this experiment? Reply `yes` to finalize.")
        return 0

    if "paper" in prompt:
        emit("The strategy has been validated by the Risk Manager. Would you like me to promote the latest run to paper trading for live observation? Reply `yes` to start the paper session.")
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
    emit("Ask-then-confirm flows (the agent asks; reply `yes` to execute):")
    emit("  data / fetch         → propose a data fetch")
    emit("  validate             → propose Risk Manager validation")
    emit("  new experiment       → propose a new experiment")
    emit("  complete / close     → propose completing the current experiment")
    emit("  paper                → propose paper trading promotion")
    emit("")
    emit("Direct actions (execute immediately):")
    emit("  backtest             → register a dataset and run the backtest")
    emit("  result               → post fake BACKTEST_RESULT metrics")
    emit("  dataset              → register a dataset")
    emit("  title / rename       → rename the experiment")
    emit("")
    emit("Lifecycle tests:")
    emit("  slow                 → 15s silent stretch + resume")
    emit("  fail / error         → exit 1 with stderr")
    return 0


if __name__ == "__main__":
    sys.exit(main())
