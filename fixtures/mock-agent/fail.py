"""Failure scenario — emit a couple of lines then exit non-zero.

Reproduces 'failed/stopped TurnCard must remain visible' regressions.
The card should NOT fade out on failure.
"""

import sys
import time


def emit(text: str, delay: float = 0.4) -> None:
    print(text, flush=True)
    time.sleep(delay)


emit("Analyst started.")
emit("Attempting to load strategy template...")
emit("ERROR: template not found", delay=0.2)
print("traceback: simulated failure", file=sys.stderr, flush=True)
sys.exit(1)
