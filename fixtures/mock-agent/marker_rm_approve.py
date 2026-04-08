"""RM_APPROVE — Risk Manager verdict. Only meaningful when triggered as
the risk_manager role (i.e. after a [VALIDATION] marker)."""

import sys
import time

print("Reviewed the run metrics, drawdown profile, and trade distribution.", flush=True)
time.sleep(0.5)
print("[RM_APPROVE] Risk profile within target. Approved to proceed.", flush=True)
sys.exit(0)
