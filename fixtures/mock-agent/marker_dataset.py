"""DATASET — block marker, agent registers a new dataset."""

import sys
import time

print("Recording the dataset I just downloaded so future runs can reuse it.", flush=True)
time.sleep(0.5)
print("", flush=True)
print("[DATASET]", flush=True)
print(
    '{"name":"BTC/USDT 1h 180d",'
    '"exchange":"binance","pairs":["BTC/USDT"],"timeframe":"1h","days":180}',
    flush=True,
)
print("[/DATASET]", flush=True)
sys.exit(0)
