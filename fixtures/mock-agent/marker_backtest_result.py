"""BACKTEST_RESULT — block marker. Agent emits normalized result JSON."""

import sys
import time

print("Backtest finished. Here is the normalized result block.", flush=True)
time.sleep(0.5)
print("", flush=True)
print("[BACKTEST_RESULT]", flush=True)
print(
    '{"metrics":[{"key":"total_return","label":"Total return",'
    '"value":0.182,"format":"percent","tone":"positive"},'
    '{"key":"sharpe","label":"Sharpe","value":1.41,"format":"number"},'
    '{"key":"max_drawdown","label":"Max drawdown","value":-0.087,'
    '"format":"percent","tone":"negative"},'
    '{"key":"n_trades","label":"Trades","value":47,"format":"number"}]}',
    flush=True,
)
print("[/BACKTEST_RESULT]", flush=True)
sys.exit(0)
