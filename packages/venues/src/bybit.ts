import type { VenueGuide } from "./types.js";

export const bybitGuide: VenueGuide = {
	venue: "bybit",
	displayName: "Bybit",

	tldr:
		"Bybit has a solid bulk portal (public.bybit.com) with tick-level trades. " +
		"Try bulk first, then ccxt paginated fetch, then v5 REST direct.",

	symbolFormat: {
		spot: "BTC/USDT, ETH/USDC (ccxt) | BTCUSDT, ETHUSDC (native REST, category=spot)",
		linearFutures:
			"BTC/USDT:USDT, BTC/USDC:USDC (ccxt) | BTCUSDT, BTCUSDC (native REST, category=linear)",
		inverseFutures:
			"BTC/USD:BTC, ADA/USD:ADA (ccxt) | BTCUSD, ADAUSD (native REST, category=inverse)",
		notes:
			"Bybit v5 uses a unified endpoint with `category` param (spot, linear, inverse). " +
			"USDC perps: 70 linear pairs. Quote currencies: USDT (dominant), USDC, EUR.\n\n" +
			"**Nautilus symbols:** Linear `BTCUSDT-LINEAR.BYBIT`, Inverse `BTCUSD-INVERSE.BYBIT`, " +
			"Spot `BTCUSDT-SPOT.BYBIT`. Tardis key: `bybit`, `bybit-spot`.",
	},

	bulkDownload: {
		url: "https://public.bybit.com/",
		format: "gzip/csv",
		dataTypes: "tick-level trades, MT4 klines",
		notes: "Inverse since 2019, linear since 2020, spot available.",
	},

	recommendedFetch: {
		language: "python",
		library: "ccxt>=4.3",
		code: [
			"import ccxt, time",
			"",
			"ex = ccxt.bybit({'enableRateLimit': True})",
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
		"Max 1000 candles per request (v5 API). Advance `since = candles[-1][0] + 1`. " +
		"Rate limit: 120 req / min for market endpoints. " +
		"On 429, back off 1-2 seconds.",

	apiDocs: "https://bybit-exchange.github.io/docs/v5/market/kline",

	knownGotchas: [
		"Position mode is auto-set to One-way by freqtrade. Use one subaccount per bot.",
		"v5 API unifies spot/linear/inverse under one endpoint with `category` param.",
		"Bybit has kline history back to ~2019 for major pairs.",
	],

	lastVerified: "2026-04-09",
	verificationNotes:
		"BTC/USDT spot + BTC/USDT:USDT linear 5m, 1000 rows each, ccxt 4.4.x.",
};
