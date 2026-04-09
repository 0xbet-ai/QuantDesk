import type { VenueGuide } from "./types.js";

export const bingxGuide: VenueGuide = {
	venue: "bingx",
	displayName: "BingX",

	tldr:
		"Use ccxt's `fetch_ohlcv` with exchange ID `bingx`. Returns up to 1000 " +
		"candles per request. Good USDC futures coverage (51 pairs). " +
		"If ccxt fails, fall back to REST `/openApi/spot/v1/market/kline` (spot) " +
		"or `/openApi/swap/v3/quote/klines` (perps).",

	symbolFormat: {
		spot:
			"BTC/USDT, ARB/USDC (ccxt) | BTC-USDT, ARB-USDC (native REST, dash-separated)",
		linearFutures:
			"BTC/USDT:USDT, BTC/USDC:USDC (ccxt) | BTC-USDT, BTC-USDC (native perps REST)",
		inverseFutures:
			"BNB/USD:BNB, DOT/USD:DOT (ccxt) | BNB-USD, DOT-USD (native REST)",
		notes:
			"USDT: 2123 spot, 633 linear perps. USDC: 32 spot, 51 linear perps. " +
			"Native REST uses dash separator (BTC-USDT).",
	},

	recommendedFetch: {
		language: "python",
		library: "ccxt>=4.3",
		code: [
			"import ccxt, time",
			"",
			"ex = ccxt.bingx({'enableRateLimit': True})",
			"ex.load_markets()",
			"",
			"symbol = 'BTC/USDT'        # spot",
			"# symbol = 'BTC/USDT:USDT' # linear USDT perps",
			"# symbol = 'BTC/USDC:USDC' # linear USDC perps",
			"timeframe = '5m'",
			"since = ex.parse8601('2024-01-01T00:00:00Z')",
			"all_candles = []",
			"",
			"while True:",
			"    candles = ex.fetch_ohlcv(symbol, timeframe, since=since, limit=1000)",
			"    if not candles:",
			"        break",
			"    all_candles.extend(candles)",
			"    since = candles[-1][0] + 1",
			"    time.sleep(ex.rateLimit / 1000)",
		].join("\n"),
	},

	pagination:
		"Max 1000 candles per request. Advance `since = candles[-1][0] + 1`. " +
		"Rate limit varies by endpoint. On 429, back off 1-2 seconds.",

	knownGotchas: [
		"Stoploss on exchange supported (stop-limit and stop-market) — one of the better-supported exchanges in freqtrade.",
		"Native REST uses dash separator (BTC-USDT), not slash or underscore.",
		"REST API docs (spot): https://bingx-api.github.io/docs/#/en-us/spot/market-api.html#K-Line%20Data",
		"REST API docs (perps): https://bingx-api.github.io/docs/#/en-us/swapV2/market-api.html#K-Line%20Data",
		"Bulk data portal: none — API-only for historical data.",
	],

	lastVerified: "2026-04-09",
	verificationNotes:
		"BTC/USDT spot + BTC/USDT:USDT perps 5m, 1000 rows, ccxt 4.4.x.",
};
