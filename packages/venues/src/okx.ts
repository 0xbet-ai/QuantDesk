import type { VenueGuide } from "./types.js";

export const okxGuide: VenueGuide = {
	venue: "okx",
	displayName: "OKX",

	tldr:
		"OKX has a bulk portal with trades (2021+) and 1m klines (2023+). " +
		"ccxt only returns 100 candles/req (very slow), so prefer bulk or direct REST.",

	symbolFormat: {
		spot: "BTC/USDT, BTC/USDC (ccxt) | BTC-USDT, BTC-USDC (native REST, instType=SPOT)",
		linearFutures:
			"BTC/USDT:USDT (ccxt) | BTC-USDT-SWAP (native REST, instType=SWAP)\n" +
			"BTC/USD:USD (ccxt, linear USD-settled) | BTC-USD-SWAP (native REST)",
		inverseFutures:
			"BTC/USD:BTC, ETH/USD:ETH (ccxt) | BTC-USD-SWAP (native REST, instType=SWAP)\n" +
			"Note: BTC/USD:BTC (inverse) and BTC/USD:USD (linear) share the same native symbol BTC-USD-SWAP but differ by ctType.",
		notes:
			"OKX has a unique split: same quote USD but different settle currencies. " +
			"ccxt disambiguates via the :SETTLE suffix. USDC: 251 spot pairs, 0 perps. " +
			"Quote currencies: USDT, USDC, USD, EUR. Passphrase required for API auth.\n\n" +
			"**Nautilus symbols:** Spot `BTC-USDT.OKX`, Swap `BTC-USDT-SWAP.OKX`, " +
			"Futures `BTC-USD-241227.OKX`. Tardis key: `okex`, `okex-swap`, `okex-futures`.",
	},

	bulkDownload: {
		url: "https://www.okx.com/en-us/historical-data",
		format: "zip/csv",
		dataTypes: "trades (2021+), 1m klines (2023+), funding rate, L2 orderbook",
		notes: "Data only goes back to Sep 2021.",
	},

	recommendedFetch: {
		language: "python",
		library: "ccxt>=4.3",
		code: [
			"import ccxt, time",
			"",
			"ex = ccxt.okx({'enableRateLimit': True})",
			"ex.load_markets()",
			"",
			"symbol = 'BTC/USDT'        # spot",
			"# symbol = 'BTC/USDT:USDT' # linear USDT-settled swap",
			"# symbol = 'BTC/USD:BTC'   # inverse swap",
			"timeframe = '5m'",
			"since = ex.parse8601('2024-01-01T00:00:00Z')",
			"all_candles = []",
			"",
			"while True:",
			"    candles = ex.fetch_ohlcv(symbol, timeframe, since=since, limit=100)",
			"    if not candles:",
			"        break",
			"    all_candles.extend(candles)",
			"    since = candles[-1][0] + 1",
			"    time.sleep(ex.rateLimit / 1000)",
		].join("\n"),
	},

	pagination:
		"Max 100 candles per request (very low — expect many requests for long ranges). " +
		"For data older than 3 months, use `/api/v5/market/history-candles` instead of " +
		"`/api/v5/market/candles`. Rate limit: 40 req / 2 seconds per endpoint. " +
		"On 429, back off for 2 seconds.",

	apiDocs: "https://www.okx.com/docs-v5/en/#order-book-trading-market-data-get-candlesticks",

	knownGotchas: [
		"Only 100 candles per API call — backtesting data download is very slow.",
		"Two separate candle endpoints: /candles (recent 3 months) and /history-candles (older).",
		"BTC/USD:BTC (inverse) vs BTC/USD:USD (linear) — same native symbol, different settle. ccxt handles this.",
		"Requires passphrase in addition to API key and secret.",
		"Use `myokx` exchange ID for EAA-registered accounts.",
	],

	lastVerified: "2026-04-09",
	verificationNotes:
		"BTC/USDT spot + BTC/USDT:USDT swap 5m, 100 rows per page, ccxt 4.4.x.",
};
