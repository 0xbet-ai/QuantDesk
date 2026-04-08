"""PROPOSE_GO_PAPER — line marker. Suggests promoting to paper trading."""

import sys
import time

print("Strategy is validated. Recommending we move to paper trading for live observation.", flush=True)
time.sleep(0.5)
print("[PROPOSE_GO_PAPER] Promote ADX+FastD baseline to paper mode for 2 weeks", flush=True)
sys.exit(0)
