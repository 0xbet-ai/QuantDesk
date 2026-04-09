import type { VenueGuide } from "./types.js";

export const kucoinGuide: VenueGuide = {
	venue: "kucoin",
	displayName: "KuCoin",

	tldr:
		"Use ccxt's `fetch_ohlcv` with exchange ID `kucoin`. Returns up to 1500 " +
		"candles per request. Requires passphrase in addition to key/secret. " +
		"If ccxt fails, fall back to REST `/api/v1/market/candles` (spot) or " +
		"KuCoin Futures API `/api/v1/kline/query`.",

	symbolFormat: {
		spot:
			"BTC/USDT, XRP/USDC, ETH/BTC (ccxt) | BTC-USDT, XRP-USDC, ETH-BTC (native REST, dash-separated)",
		linearFutures:
			"BTC/USDT:USDT, ETH/USDC:USDC (ccxt) | XBTUSDTM, ETHUSDCM (native Futures REST)",
		inverseFutures:
			"BTC/USD:BTC, ETH/USD:ETH (ccxt) | XBTUSDM, ETHUSDM (native Futures REST)",
		notes:
			"USDT: 928 spot, 561 linear perps. USDC: 59 spot, 7 linear perps. " +
			"Native futures symbols use M suffix (XBTUSDTM). " +
			"Passphrase required for all authenticated endpoints.",
	},

	recommendedFetch: {
		language: "python",
		library: "ccxt>=4.3",
		code: [
			"import ccxt, time",
			"",
			"ex = ccxt.kucoin({'enableRateLimit': True})",
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
			"    candles = ex.fetch_ohlcv(symbol, timeframe, since=since, limit=1500)",
			"    if not candles:",
			"        break",
			"    all_candles.extend(candles)",
			"    since = candles[-1][0] + 1",
			"    time.sleep(ex.rateLimit / 1000)",
		].join("\n"),
	},

	pagination:
		"Max 1500 candles per request (spot). Advance `since = candles[-1][0] + 1`. " +
		"Rate limit: 30 req / 3 seconds for market data. " +
		"On 429, back off 1-2 seconds.",

	knownGotchas: [
		"Requires passphrase in config (key + secret + passphrase).",
		"Blacklist KCS/<STAKE> to avoid fee token complications (same as BNB on Binance).",
		"Native futures symbols use XBT (not BTC) with M suffix: XBTUSDTM. ccxt normalises.",
		"USDC futures support is very limited (only 7 pairs).",
		"REST API docs (spot): https://www.kucoin.com/docs/rest/spot-trading/market-data/get-klines",
		"REST API docs (futures): https://www.kucoin.com/docs/rest/futures-trading/market-data/get-klines",
	],

	lastVerified: "2026-04-09",
	verificationNotes:
		"BTC/USDT spot 5m 1500 rows, ccxt 4.4.x.",
};
