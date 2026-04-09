import type { VenueGuide } from "./types.js";

export const htxGuide: VenueGuide = {
	venue: "htx",
	displayName: "HTX",

	tldr:
		"Use ccxt's `fetch_ohlcv` with exchange ID `htx`. Returns up to 2000 " +
		"candles per request (spot). All linear perps are USDT-settled only. " +
		"If ccxt fails, fall back to REST `/market/history/kline` (spot) or " +
		"`/linear-swap-ex/market/history/kline` (linear swap).",

	symbolFormat: {
		spot:
			"BTC/USDT, ETH/BTC (ccxt) | btcusdt, ethbtc (native REST, lowercase concatenated)",
		linearFutures:
			"BTC/USDT:USDT (ccxt) | BTC-USDT (native linear swap REST, dash-separated)",
		inverseFutures:
			"BTC/USD:BTC, ETH/USD:ETH (ccxt) | BTC-USD (native coin swap REST)",
		notes:
			"USDT: 1242 spot, 219 linear perps. USDC: 47 spot only, 0 futures. " +
			"Native spot symbols are lowercase concatenated (btcusdt). " +
			"Native futures use dash (BTC-USDT). Formerly Huobi.",
	},

	recommendedFetch: {
		language: "python",
		library: "ccxt>=4.3",
		code: [
			"import ccxt, time",
			"",
			"ex = ccxt.htx({'enableRateLimit': True})",
			"ex.load_markets()",
			"",
			"symbol = 'BTC/USDT'        # spot",
			"# symbol = 'BTC/USDT:USDT' # linear swap",
			"# symbol = 'BTC/USD:BTC'   # inverse swap",
			"timeframe = '5m'",
			"since = ex.parse8601('2024-01-01T00:00:00Z')",
			"all_candles = []",
			"",
			"while True:",
			"    candles = ex.fetch_ohlcv(symbol, timeframe, since=since, limit=2000)",
			"    if not candles:",
			"        break",
			"    all_candles.extend(candles)",
			"    since = candles[-1][0] + 1",
			"    time.sleep(ex.rateLimit / 1000)",
		].join("\n"),
	},

	pagination:
		"Max 2000 candles per request (spot), 2000 for swaps. " +
		"Advance `since = candles[-1][0] + 1`. " +
		"Rate limit: 800 req / min for market data. On 429, back off 1 second.",

	knownGotchas: [
		"Exchange ID in ccxt is `htx` (rebranded from `huobi`).",
		"Native spot symbols are lowercase concatenated (btcusdt), not slash-separated.",
		"Only stoploss-limit on exchange for spot trading in freqtrade.",
		"Futures support is listed but limited in freqtrade docs (spot + stoploss mainly).",
		"REST API docs (spot): https://www.htx.com/en-us/opend/newApiPages/?id=7ec4a2ba-7773-11ed-9966-0242ac110003",
		"REST API docs (swaps): https://www.htx.com/en-us/opend/newApiPages/?id=8cb09012-77b5-11ed-9966-0242ac110003",
	],

	lastVerified: "2026-04-09",
	verificationNotes:
		"BTC/USDT spot 5m, 2000 rows, ccxt 4.4.x.",
};
