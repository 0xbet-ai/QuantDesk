import type { VenueGuide } from "./types.js";

export const bitmexGuide: VenueGuide = {
	venue: "bitmex",
	displayName: "BitMEX",

	tldr:
		"BitMEX is nautilus-only (no freqtrade). Use Nautilus's native BitMEX adapter " +
		"or Tardis CSV loader for historical data. For direct API fallback, use " +
		"`GET /api/v1/trade/bucketed` for OHLCV bars.",

	symbolFormat: {
		linearFutures:
			"XBTUSD.BITMEX, ETHUSD.BITMEX (nautilus) | XBTUSD, ETHUSD (native REST)\n" +
			"Monthly futures: XBTM25.BITMEX (nautilus) | XBTM25 (native REST, root+monthcode+year)",
		notes:
			"BitMEX uses XBT for BTC — Nautilus does NOT normalise this (unlike ccxt). " +
			"No spot market. Perpetuals use no suffix in native symbols. " +
			"Tardis exchange key: `bitmex`.",
	},

	recommendedFetch: {
		language: "python",
		library: "nautilus_trader or httpx",
		code: [
			"# Option 1: Tardis CSV (preferred for bulk)",
			"# Download from Tardis, then load:",
			"from nautilus_trader.adapters.tardis import TardisCSVDataLoader",
			"trades = TardisCSVDataLoader.load_trades('path/to/trades.csv.gz')",
			"",
			"# Option 2: Direct REST API fallback",
			"import httpx",
			"",
			"url = 'https://www.bitmex.com/api/v1/trade/bucketed'",
			"params = {",
			"    'binSize': '5m',",
			"    'symbol': 'XBTUSD',",
			"    'count': 1000,",
			"    'startTime': '2024-01-01T00:00:00Z',",
			"    'reverse': False,",
			"}",
			"resp = httpx.get(url, params=params)",
			"candles = resp.json()",
			"# Paginate: advance startTime to last candle timestamp + 1",
		].join("\n"),
	},

	pagination:
		"REST API: max 1000 rows per request. Advance `startTime` to last timestamp. " +
		"Rate limit: 30 req / min (unauthenticated), 60 req / min (authenticated). " +
		"On 429, honour Retry-After.",

	apiDocs: "https://www.bitmex.com/api/explorer/#!/Trade/Trade_getBucketed",

	knownGotchas: [
		"Uses XBT for Bitcoin, not BTC. Nautilus preserves this (no normalisation).",
		"No spot market — derivatives only (perpetuals + dated futures).",
		"Nautilus adapter has both data and execution clients.",
		"Tardis exchange key is `bitmex`.",
	],

	lastVerified: "2026-04-09",
	verificationNotes:
		"XBTUSD 5m bucketed, 1000 rows via REST. Tardis CSV load verified with trades file.",
};
