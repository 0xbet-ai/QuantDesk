"""PROPOSE_NEW_EXPERIMENT — line marker. Suggests a fresh experiment."""

import sys
import time

print("This run shows ADX threshold may be too high. Worth a second experiment.", flush=True)
time.sleep(0.5)
print("[PROPOSE_NEW_EXPERIMENT] Lower ADX threshold to 20 and re-test", flush=True)
sys.exit(0)
