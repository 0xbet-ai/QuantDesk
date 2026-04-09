import type { VenueGuide } from "./types.js";

export const bitgetGuide: VenueGuide = {
	venue: "bitget",
	displayName: "Bitget",

	tldr:
		"Use ccxt's `fetch_ohlcv` with exchange ID `bitget`. Returns up to 1000 " +
		"candles per request. Good USDC futures support (50 pairs). Requires passphrase. " +
		"If ccxt fails, fall back to REST `/api/v2/spot/market/candles` (spot) or " +
		"`/api/v2/mix/market/candles` (futures).",

	symbolFormat: {
		spot:
			"BTC/USDT, ETH/USDC (ccxt) | BTCUSDT, ETHUSDC (native REST, productType=USDT-FUTURES)",
		linearFutures:
			"BTC/USDT:USDT, BTC/USDC:USDC (ccxt) | BTCUSDT, BTCUSDC (native REST, productType varies)",
		inverseFutures:
			"BTC/USD:BTC, ETH/USD:ETH (ccxt) | BTCUSD, ETHUSD (native REST, productType=COIN-FUTURES)",
		notes:
			"USDT: 620 spot, 542 linear perps. USDC: 39 spot, 50 linear perps. " +
			"Bitget has good USDC futures coverage among freqtrade exchanges. " +
			"Passphrase required for all authenticated endpoints.",
	},

	recommendedFetch: {
		language: "python",
		library: "ccxt>=4.3",
		code: [
			"import ccxt, time",
			"",
			"ex = ccxt.bitget({'enableRateLimit': True})",
			"ex.load_markets()",
			"",
			"symbol = 'BTC/USDT'        # spot",
			"# symbol = 'BTC/USDT:USDT' # linear USDT perps",
			"# symbol = 'BTC/USDC:USDC' # linear USDC perps",
			"# symbol = 'BTC/USD:BTC'   # inverse perps",
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
		"Rate limit: 20 req / second for market data. On 429, back off 1 second.",

	knownGotchas: [
		"Requires passphrase in addition to API key and secret.",
		"Position mode is auto-set to One-way by freqtrade.",
		"productType in native REST varies: USDT-FUTURES, USDC-FUTURES, COIN-FUTURES.",
		"REST API docs (v2): https://www.bitget.com/api-doc/spot/market/Get-Candle-Data",
		"REST API docs (futures): https://www.bitget.com/api-doc/contract/market/Get-Candle-Data",
	],

	lastVerified: "2026-04-09",
	verificationNotes:
		"BTC/USDT spot + BTC/USDT:USDT + BTC/USDC:USDC futures 5m, 1000 rows, ccxt 4.4.x.",
};
