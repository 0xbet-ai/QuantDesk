"""Slow scenario — long silent stretch in the middle.

Reproduces 'TurnCard disappears while agent is idle' bugs. The agent
emits one line, sits silent for 15 seconds, then resumes. The card must
stay mounted the entire time.
"""

import sys
import time


def emit(text: str, delay: float = 0.4) -> None:
    print(text, flush=True)
    time.sleep(delay)


emit("Analyst started. Pulling up prior runs.")
emit("Loading dataset metadata...")
time.sleep(15)
emit("Done. Continuing analysis.")
emit("")
emit("(mock agent — slow scenario complete)")
sys.exit(0)
