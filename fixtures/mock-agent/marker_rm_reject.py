"""RM_REJECT — Risk Manager verdict (negative). Same trigger context as
RM_APPROVE but with concrete blocking concerns."""

import sys
import time

print("Reviewed the run. Drawdown is concerning given the leverage assumption.", flush=True)
time.sleep(0.5)
print("[RM_REJECT] Max drawdown exceeds desk stop-loss budget; needs position sizing fix", flush=True)
sys.exit(0)
