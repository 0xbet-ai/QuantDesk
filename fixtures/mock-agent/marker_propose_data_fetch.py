"""PROPOSE_DATA_FETCH — block marker with JSON payload.

Triggers the data-fetch proposal card (CLAUDE.md rule #13). Server creates
a pending proposal; UI should render an Approve/Reject card.
"""

import sys
import time

print("Reviewing the desk. Need historical OHLCV before writing strategy code.", flush=True)
time.sleep(0.5)
print("", flush=True)
print("[PROPOSE_DATA_FETCH]", flush=True)
print(
    '{"exchange":"binance","pairs":["BTC/USDT"],"timeframe":"1h",'
    '"days":180,"tradingMode":"spot",'
    '"rationale":"Six months of hourly BTC/USDT for the ADX+FastD baseline."}',
    flush=True,
)
print("[/PROPOSE_DATA_FETCH]", flush=True)
sys.exit(0)
