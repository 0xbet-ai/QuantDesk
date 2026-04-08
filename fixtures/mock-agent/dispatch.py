"""Keyword dispatcher.

Reads the user prompt from stdin (server pipes the full prompt into the
docker container) and emits a different mock response depending on which
keyword the user typed in the web UI. Lets you exercise every marker /
scenario without editing files between turns.

Match priority: first hit wins, in the order below. Keep the keyword set
short and obvious so the user can remember them while clicking around.
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


def main() -> int:
    raw = sys.stdin.read() if not sys.stdin.isatty() else ""
    prompt = raw.lower()

    # ── single-keyword routes ────────────────────────────────────────────
    if "data" in prompt or "fetch" in prompt or "데이터" in raw:
        emit("Need historical OHLCV before writing strategy code.")
        emit("")
        block(
            "PROPOSE_DATA_FETCH",
            '{"exchange":"binance","pairs":["BTC/USDT"],"timeframe":"1h",'
            '"days":180,"tradingMode":"spot",'
            '"rationale":"Six months of hourly BTC/USDT for the baseline."}',
        )
        return 0

    if "backtest" in prompt or "백테" in raw:
        emit("Strategy code is ready. Running the baseline backtest now.")
        emit("")
        block("RUN_BACKTEST", '{"strategyName":"AdxFastdBaseline","entrypoint":"strategy.py"}')
        return 0

    if "result" in prompt or "metric" in prompt or "결과" in raw:
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

    if "title" in prompt or "rename" in prompt or "이름" in raw:
        emit("Renaming this experiment.")
        emit("[EXPERIMENT_TITLE] ADX+FastD baseline on BTC/USDT 1h")
        return 0

    if "validate" in prompt or "validation" in prompt or "검증" in raw:
        emit("Asking the Risk Manager to validate.")
        emit("[PROPOSE_VALIDATION] Sharpe 1.41, MDD -8.7%, ready for second opinion")
        return 0

    if "new experiment" in prompt or "새 실험" in raw or "new exp" in prompt:
        emit("Worth a second experiment with a lower ADX threshold.")
        emit("[PROPOSE_NEW_EXPERIMENT] Lower ADX threshold to 20 and re-test")
        return 0

    if "complete" in prompt or "close" in prompt or "종료" in raw:
        emit("Three runs converged. Ready to close this experiment.")
        emit("[PROPOSE_COMPLETE_EXPERIMENT] Baseline established, no further iterations")
        return 0

    if "paper" in prompt or "페이퍼" in raw:
        if "run" in prompt or "start" in prompt or "시작" in raw:
            emit("Starting the paper trading session now.")
            emit("[RUN_PAPER] AdxFastdBaseline")
            return 0
        emit("Strategy is validated. Recommending paper trading.")
        emit("[PROPOSE_GO_PAPER] Promote ADX+FastD baseline to paper for 2 weeks")
        return 0

    if "approve" in prompt or "승인" in raw:
        emit("Reviewed the run metrics, drawdown profile, and trade distribution.")
        emit("[RM_APPROVE] Risk profile within target. Approved to proceed.")
        return 0

    if "reject" in prompt or "거절" in raw or "거부" in raw:
        emit("Reviewed the run. Drawdown is concerning given the leverage assumption.")
        emit("[RM_REJECT] Max drawdown exceeds desk stop-loss budget; needs sizing fix")
        return 0

    # ── lifecycle scenarios ──────────────────────────────────────────────
    if "slow" in prompt or "느리" in raw:
        emit("Pulling up prior runs.")
        emit("Loading dataset metadata...")
        time.sleep(15)
        emit("Done. Continuing analysis.")
        emit("(slow scenario complete)")
        return 0

    if "fail" in prompt or "error" in prompt or "에러" in raw or "실패" in raw:
        emit("Attempting to load strategy template...")
        emit("ERROR: template not found", delay=0.2)
        print("traceback: simulated failure", file=sys.stderr, flush=True)
        return 1

    # ── default: happy path, no markers ──────────────────────────────────
    emit("Analyst started. Reviewing the desk context.")
    emit("")
    emit("## Strategy outline")
    emit("- ADX > 25 entries only (strong trend)")
    emit("- FastD crossover for timing")
    emit("- Stop-loss at 2 percent")
    emit("")
    emit("Type a keyword to test a specific marker:")
    emit("  data / backtest / result / dataset / title / validate /")
    emit("  new experiment / complete / paper / run paper /")
    emit("  approve / reject / slow / fail")
    return 0


if __name__ == "__main__":
    sys.exit(main())
