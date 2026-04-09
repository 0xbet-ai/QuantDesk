import type { VenueGuide } from "./types.js";

export const dydxGuide: VenueGuide = {
	venue: "dydx",
	displayName: "dYdX",

	tldr:
		"dYdX is nautilus-only. Use Nautilus's native dYdX adapter or Tardis CSV " +
		"loader for historical data. dYdX v4 is a Cosmos SDK chain — the indexer " +
		"REST API at `indexer.dydx.trade` serves historical candles.",

	symbolFormat: {
		linearFutures:
			"BTC-USD.DYDX, ETH-USD.DYDX (nautilus) | BTC-USD, ETH-USD (native indexer API)",
		notes:
			"All markets are perpetuals settled in USDC. Symbol format is simple: BASE-USD. " +
			"No spot market. dYdX v4 runs on its own Cosmos chain. " +
			"Tardis exchange key: `dydx`.",
	},

	recommendedFetch: {
		language: "python",
		library: "nautilus_trader or httpx",
		code: [
			"# Option 1: Tardis CSV (preferred for bulk)",
			"from nautilus_trader.adapters.tardis import TardisCSVDataLoader",
			"trades = TardisCSVDataLoader.load_trades('path/to/trades.csv.gz')",
			"",
			"# Option 2: Direct REST API fallback (dYdX v4 indexer)",
			"import httpx",
			"",
			"url = 'https://indexer.dydx.trade/v4/candles/perpetualMarkets/BTC-USD'",
			"params = {",
			"    'resolution': '5MINS',  # 1MIN, 5MINS, 15MINS, 30MINS, 1HOUR, 4HOURS, 1DAY",
			"    'limit': 100,",
			"    'fromISO': '2024-01-01T00:00:00Z',",
			"    'toISO': '2024-01-02T00:00:00Z',",
			"}",
			"resp = httpx.get(url, params=params)",
			"candles = resp.json()['candles']",
			"# Paginate: advance fromISO to last candle startedAt",
		].join("\n"),
	},

	pagination:
		"Indexer returns max 100 candles per request. Advance `fromISO` to last candle time. " +
		"Rate limit: 100 req / 10 seconds. On 429, back off 1-2 seconds.",

	apiDocs: "https://docs.dydx.trade/api_integration-indexer/indexer_api",

	knownGotchas: [
		"dYdX v4 is Cosmos SDK-based — completely different from v3 (StarkEx).",
		"All markets are perpetuals (no spot). Settled in USDC.",
		"Nautilus adapter uses gRPC for execution (Cosmos SDK transaction signing).",
		"Indexer API is the REST interface; the chain itself uses gRPC/WebSocket.",
		"Resolution values are strings: 1MIN, 5MINS, 15MINS, 30MINS, 1HOUR, 4HOURS, 1DAY.",
		"Tardis exchange key: `dydx` (covers v4).",
	],

	lastVerified: "2026-04-09",
	verificationNotes:
		"BTC-USD 5MINS candles via indexer REST, 100 rows. Tardis CSV verified.",
};
