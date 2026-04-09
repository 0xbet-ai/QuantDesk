import type { VenueGuide } from "./types.js";

export const krakenGuide: VenueGuide = {
	venue: "kraken",
	displayName: "Kraken",

	tldr:
		"Use ccxt's `fetch_ohlcv` — Kraken returns max 720 candles per request. " +
		"Internally uses XBT but ccxt normalises to BTC. For spot use exchange ID " +
		"`kraken`; for futures use `krakenfutures` (separate API). " +
		"If ccxt is insufficient, use REST `/0/public/OHLC` (spot) or Kraken Futures API.",

	symbolFormat: {
		spot:
			"BTC/USD, BTC/EUR, ETH/USD, BTC/USDT, BTC/USDC (ccxt) | " +
			"XXBTZUSD, XETHZUSD (native REST, uses XBT not BTC)",
		linearFutures:
			"BTC/USD:USD, ETH/USD:USD (ccxt, exchange=krakenfutures) | " +
			"PF_XBTUSD, PF_ETHUSD (native Kraken Futures REST)",
		inverseFutures:
			"BTC/USD:BTC, ETH/USD:ETH (ccxt, exchange=krakenfutures) | " +
			"FI_XBTUSD, FI_ETHUSD (native Kraken Futures REST)",
		notes:
			"Kraken spot uses real USD and EUR as primary quote (not USDT). " +
			"USDT: 48 pairs, USDC: 45 pairs. " +
			"ccxt normalises XBT -> BTC via commonCurrencies — always use BTC in ccxt symbols. " +
			"Spot and futures are completely separate exchange classes in ccxt.\n\n" +
			"**Nautilus symbols:** Spot `XBT/USDT.KRAKEN` (keeps XBT, NOT normalised!), " +
			"Perp `PF_XBTUSD.KRAKEN`. Tardis key: `kraken`.",
	},

	recommendedFetch: {
		language: "python",
		library: "ccxt>=4.3",
		code: [
			"import ccxt, time",
			"",
			"# Spot",
			"ex = ccxt.kraken({'enableRateLimit': True})",
			"# Futures: ex = ccxt.krakenfutures({'enableRateLimit': True})",
			"ex.load_markets()",
			"",
			"symbol = 'BTC/USD'         # spot (real USD)",
			"# symbol = 'BTC/USD:USD'   # linear futures (krakenfutures)",
			"# symbol = 'BTC/USD:BTC'   # inverse futures (krakenfutures)",
			"timeframe = '5m'",
			"since = ex.parse8601('2024-01-01T00:00:00Z')",
			"all_candles = []",
			"",
			"while True:",
			"    candles = ex.fetch_ohlcv(symbol, timeframe, since=since, limit=720)",
			"    if not candles:",
			"        break",
			"    all_candles.extend(candles)",
			"    since = candles[-1][0] + 1",
			"    time.sleep(ex.rateLimit / 1000)",
		].join("\n"),
	},

	pagination:
		"Max 720 candles per request (spot). Advance `since = candles[-1][0] + 1`. " +
		"Rate limit: tier-based, ~15 calls per minute for public endpoints. " +
		"Data download is memory-intensive — freqtrade docs recommend `--dl-trades` for backtesting. " +
		"On 429, wait 5 seconds.",

	knownGotchas: [
		"Two separate ccxt exchange IDs: `kraken` (spot) and `krakenfutures` (derivatives).",
		"XBT is normalised to BTC by ccxt — never use XBT in ccxt symbols.",
		"Primary quote is real USD, not USDT. EUR is equally prominent.",
		"Data download requires significantly more RAM than other exchanges.",
		"REST API docs (spot): https://docs.kraken.com/api/docs/rest-api/get-ohlc-data",
		"REST API docs (futures): https://docs.futures.kraken.com/#http-api-charts-ohlc",
		"Bulk data: OHLCVT ZIPs via Google Drive (https://support.kraken.com/articles/360047124832). Quarterly updates, clunky for automation.",
	],

	lastVerified: "2026-04-09",
	verificationNotes:
		"BTC/USD spot 5m 720 rows, ccxt 4.4.x. krakenfutures BTC/USD:USD verified separately.",
};
