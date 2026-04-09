import type { VenueGuide } from "./types.js";

export const gateIoGuide: VenueGuide = {
	venue: "gate_io",
	displayName: "Gate.io",

	tldr:
		"Use ccxt's `fetch_ohlcv` with exchange ID `gateio`. Returns up to 1000 " +
		"candles per request. All linear perps are USDT-settled only (no USDC futures). " +
		"If ccxt fails, fall back to REST `/api/v4/spot/candlesticks` (spot) or " +
		"`/api/v4/futures/usdt/candlesticks` (futures).",

	symbolFormat: {
		spot:
			"BTC/USDT, ETH/USDC (ccxt) | BTC_USDT, ETH_USDC (native REST, underscore-separated)",
		linearFutures:
			"BTC/USDT:USDT (ccxt) | BTC_USDT (native futures REST, settle=usdt)",
		inverseFutures:
			"BTC/USD:BTC (ccxt, only 1 pair) | BTC_USD (native REST, settle=btc)",
		notes:
			"USDT dominates: 2130 spot, all 643 linear perps. USDC: 66 spot only, 0 futures. " +
			"Native REST uses underscore separator (BTC_USDT), not slash.",
	},

	recommendedFetch: {
		language: "python",
		library: "ccxt>=4.3",
		code: [
			"import ccxt, time",
			"",
			"ex = ccxt.gateio({'enableRateLimit': True})",
			"ex.load_markets()",
			"",
			"symbol = 'BTC/USDT'        # spot",
			"# symbol = 'BTC/USDT:USDT' # linear futures",
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
		"Rate limit: 900 req / min for public endpoints. " +
		"On 429, back off for `Retry-After` header value.",

	knownGotchas: [
		"ccxt exchange ID is `gateio` (no dot, no underscore).",
		"POINT token fee handling — set `unknown_fee_rate` in freqtrade config.",
		"Needs Spot/Perpetual Futures + Wallet (read) + Account (read) API permissions.",
		"Native REST uses underscore in pairs (BTC_USDT), ccxt uses slash (BTC/USDT).",
		"REST API docs (spot): https://www.gate.io/docs/developers/apiv4/#spot-market-candlesticks",
		"REST API docs (futures): https://www.gate.io/docs/developers/apiv4/#futures-market-candlesticks",
		"Bulk data portal: https://download.gatedata.org/ — deals, orderbooks, candlesticks. Free gzip/CSV.",
	],

	lastVerified: "2026-04-09",
	verificationNotes:
		"BTC/USDT spot + BTC/USDT:USDT futures 5m, 1000 rows, ccxt 4.4.x.",
};
