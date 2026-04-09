import type { VenueGuide } from "./types.js";

export const bitmartGuide: VenueGuide = {
	venue: "bitmart",
	displayName: "BitMart",

	tldr:
		"Use ccxt's `fetch_ohlcv` with exchange ID `bitmart`. Returns up to 200 " +
		"candles per request (low limit — pagination-heavy). All linear perps are " +
		"USDT-settled. If ccxt fails, fall back to REST " +
		"`/spot/quotation/v3/lite-klines` (spot) or `/contract/public/kline` (futures).",

	symbolFormat: {
		spot:
			"BTC/USDT, SOL/USDC (ccxt) | BTC_USDT, SOL_USDC (native REST, underscore-separated)",
		linearFutures:
			"BTC/USDT:USDT (ccxt) | BTCUSDT (native futures REST, concatenated)",
		notes:
			"USDT: 1336 spot, 865 perps. USDC: 32 spot, 5 perps (but USDT-settled! BTC/USDC:USDT). " +
			"No inverse futures. Requires API key Memo (UID). Verification Level 2 needed.",
	},

	recommendedFetch: {
		language: "python",
		library: "ccxt>=4.3",
		code: [
			"import ccxt, time",
			"",
			"ex = ccxt.bitmart({'enableRateLimit': True})",
			"ex.load_markets()",
			"",
			"symbol = 'BTC/USDT'        # spot",
			"# symbol = 'BTC/USDT:USDT' # linear futures",
			"timeframe = '5m'",
			"since = ex.parse8601('2024-01-01T00:00:00Z')",
			"all_candles = []",
			"",
			"while True:",
			"    candles = ex.fetch_ohlcv(symbol, timeframe, since=since, limit=200)",
			"    if not candles:",
			"        break",
			"    all_candles.extend(candles)",
			"    since = candles[-1][0] + 1",
			"    time.sleep(ex.rateLimit / 1000)",
		].join("\n"),
	},

	pagination:
		"Max 200 candles per request (very low — expect many iterations). " +
		"Advance `since = candles[-1][0] + 1`. " +
		"Rate limit: 15 req / second for public endpoints. On 429, back off 2 seconds.",

	knownGotchas: [
		"Only 200 candles per request — pagination is slow for long date ranges.",
		"USDC perps exist (5 pairs) but are actually USDT-settled (BTC/USDC:USDT).",
		"Requires API key Memo (UID) for authentication — not just key/secret.",
		"No stoploss on exchange support in freqtrade.",
		"Verification Level 2 needed for API access.",
		"REST API docs (spot): https://developer-pro.bitmart.com/en/spot/#get-history-k-line-v3",
		"REST API docs (futures): https://developer-pro.bitmart.com/en/futuresv2/#get-k-line",
	],

	lastVerified: "2026-04-09",
	verificationNotes:
		"BTC/USDT spot 5m, 200 rows, ccxt 4.4.x.",
};
