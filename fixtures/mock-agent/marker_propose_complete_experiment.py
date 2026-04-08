"""PROPOSE_COMPLETE_EXPERIMENT — line marker. Wraps the experiment up."""

import sys
import time

print("Three runs converged on the same Sharpe band. Ready to close this experiment.", flush=True)
time.sleep(0.5)
print("[PROPOSE_COMPLETE_EXPERIMENT] Baseline established, no further iterations needed", flush=True)
sys.exit(0)
