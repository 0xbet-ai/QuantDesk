"""PROPOSE_VALIDATION — line marker. Triggers Risk Manager turn."""

import sys
import time

print("Baseline metrics look promising. Asking the Risk Manager to validate.", flush=True)
time.sleep(0.5)
print("[PROPOSE_VALIDATION] Sharpe 1.41, MDD -8.7%, ready for second opinion", flush=True)
sys.exit(0)
