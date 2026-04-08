"""RUN_BACKTEST — block marker, server kicks off engine docker run."""

import sys
import time

print("Strategy code is ready. Running the baseline backtest now.", flush=True)
time.sleep(0.5)
print("", flush=True)
print("[RUN_BACKTEST]", flush=True)
print('{"strategyName":"AdxFastdBaseline","entrypoint":"strategy.py"}', flush=True)
print("[/RUN_BACKTEST]", flush=True)
sys.exit(0)
