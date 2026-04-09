import type { VenueGuide } from "./types.js";

export const binanceGuide: VenueGuide = {
	venue: "binance",
	displayName: "Binance",

	tldr:
		"Use ccxt's `fetch_ohlcv` with enableRateLimit. Binance returns up to " +
		"1000 candles per request. Paginate by advancing `since` to " +
		"`candles[-1][0] + 1`. If ccxt fails, fall back to the public REST " +
		"endpoint `/api/v3/klines` (spot) or `/fapi/v1/klines` (USDT-M futures).",

	symbolFormat: {
		spot: "BTC/USDT, BTC/USDC, ETH/BTC (ccxt) | BTCUSDT, BTCUSDC, ETHBTC (native REST)",
		linearFutures:
			"BTC/USDT:USDT, BTC/USDC:USDC (ccxt) | BTCUSDT, BTCUSDC (native REST, USDT-M futures)",
		inverseFutures:
			"BTC/USD:BTC, ETH/USD:ETH (ccxt) | BTCUSD_PERP, ETHUSD_PERP (native REST, COIN-M futures)",
		notes:
			"Quote currencies: USDT (dominant), USDC (38 linear perps), BTC, FDUSD, BNB, ETH. " +
			"BUSD is delisted. Spot and futures are separate API domains.",
	},

	recommendedFetch: {
		language: "python",
		library: "ccxt>=4.3",
		code: [
			"import ccxt, time",
			"",
			"ex = ccxt.binance({'enableRateLimit': True})",
			"ex.load_markets()",
			"",
			"symbol = 'BTC/USDT'        # spot",
			"# symbol = 'BTC/USDT:USDT' # linear futures",
			"# symbol = 'BTC/USD:BTC'   # inverse futures",
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
		"Rate limit: 2400 req weight / min (spot), 2400 req weight / min (futures). " +
		"Each kline request costs weight 1-5 depending on limit. " +
		"On 429 or 418, honour `Retry-After` header and back off.",

	knownGotchas: [
		"Futures use separate API base: fapi.binance.com (USDT-M) and dapi.binance.com (COIN-M).",
		"Blacklist BNB/<STAKE> pairs to avoid fee token complications.",
		"Position mode must be One-way Mode, asset mode must be Single-Asset Mode for futures.",
		"1m candles go back to exchange launch; smaller timeframes may have gaps.",
		"REST API docs (spot): https://developers.binance.com/docs/binance-spot-api-docs/rest-api",
		"REST API docs (futures): https://developers.binance.com/docs/derivatives/usds-margined-futures/general-info",
	],

	lastVerified: "2026-04-09",
	verificationNotes:
		"BTC/USDT spot 5m, 1000 rows, ccxt 4.4.x. BTC/USDT:USDT linear perps verified separately.",
};
