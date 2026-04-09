# Path B fetch guide — <venue display name>

> **Status:** template / example. Not copied into workspaces.
> Directories starting with `_` are skipped by the loader.

This file shows the shape a real `path-b-fetch.md` should take. Copy it
to `packages/venues/<venue-id>/path-b-fetch.md` and replace every
section with verified, venue-specific content. An empty or half-written
guide is worse than no guide at all — delete the file rather than ship
placeholder text.

---

## TL;DR

One paragraph. When Path A fails for this venue, what's the shortest
known-good route to OHLCV data? (e.g. *"ccxt fully supports spot +
linear futures; use `fetch_ohlcv` with pagination. Hyperliquid-style
on-chain venues should skip ccxt and hit `<endpoint>` directly."*)

## Symbol format

How does this venue spell its pairs?

- spot: `BTC/USDT` (ccxt) ↔ `BTCUSDT` (native REST)
- linear futures: `BTC/USDT:USDT` (ccxt) ↔ `BTCUSDT` (native REST)
- inverse futures: ...
- settlement currency rules, perpetual vs. dated, etc.

## Recommended fetch method

Pick one and commit to it. Don't list five options — the agent will
just pick the wrong one.

```python
# Example: ccxt route (replace with a verified working snippet)
import ccxt
ex = ccxt.<venue>({"enableRateLimit": True})
ex.load_markets()
candles = ex.fetch_ohlcv("BTC/USDT:USDT", timeframe="5m", since=..., limit=1000)
```

Or, when ccxt doesn't cover the venue:

```python
# Example: raw REST route
import httpx
r = httpx.get("https://...", params={...})
...
```

## Pagination

- max candles per request
- how to advance `since` / `before` / cursor
- server-side rate limit: N requests / M seconds
- 429 handling

## Known gotchas

- missing timeframes? (e.g. no 1-minute before year X)
- futures vs. perpetual naming collisions
- UTC vs. local ms timestamps
- any venue-specific auth required even for public OHLCV

## Last verified

`YYYY-MM-DD` — briefly describe what was tested (which pair, which
timeframe, which lib version). Venue APIs drift; stale guides are a
trap.
