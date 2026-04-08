"""Happy-path mock agent scenario.

Streams a sequence of plain-text lines on a controlled schedule so the
TurnCard / CommentThread lifecycle can be exercised end-to-end without
the real Claude/Codex CLI. No markers — first verify status transitions
(running -> completed) and message rendering before adding marker
scenarios.
"""

import sys
import time


def emit(text: str, delay: float = 10.0) -> None:
    print(text, flush=True)
    time.sleep(delay)


emit("Analyst started. Reviewing the desk context.")
emit("")
emit("## Strategy outline")
emit("- ADX > 25 entries only (strong trend)")
emit("- FastD crossover for timing")
emit("- Stop-loss at 2 percent")
emit("")
emit("## Next step")
emit("Need 6 months of BTC/USDC 1h candles before writing code.")
emit("")
emit("(mock agent — turn complete)", delay=0.5)
sys.exit(0)
