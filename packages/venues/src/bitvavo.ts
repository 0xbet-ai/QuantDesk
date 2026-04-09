import type { VenueGuide } from "./types.js";

export const bitvavoGuide: VenueGuide = {
	venue: "bitvavo",
	displayName: "Bitvavo",

	tldr:
		"Use ccxt's `fetch_ohlcv` with exchange ID `bitvavo`. Returns up to 1440 " +
		"candles per request. Spot only — no futures. EUR is the primary quote " +
		"currency (not USDT). If ccxt fails, fall back to REST " +
		"`/v2/<market>/candles`.",

	symbolFormat: {
		spot:
			"BTC/EUR, ETH/EUR, SOL/USDC (ccxt) | BTC-EUR, ETH-EUR, SOL-USDC (native REST, dash-separated)",
		notes:
			"EUR: 431 pairs (dominant). USDC: 11 pairs. No USDT at all. " +
			"No futures, no margin. Netherlands-based, EU-focused exchange.",
	},

	recommendedFetch: {
		language: "python",
		library: "ccxt>=4.3",
		code: [
			"import ccxt, time",
			"",
			"ex = ccxt.bitvavo({'enableRateLimit': True})",
			"ex.load_markets()",
			"",
			"symbol = 'BTC/EUR'         # primary quote is EUR",
			"# symbol = 'SOL/USDC'      # limited USDC pairs",
			"timeframe = '5m'",
			"since = ex.parse8601('2024-01-01T00:00:00Z')",
			"all_candles = []",
			"",
			"while True:",
			"    candles = ex.fetch_ohlcv(symbol, timeframe, since=since, limit=1440)",
			"    if not candles:",
			"        break",
			"    all_candles.extend(candles)",
			"    since = candles[-1][0] + 1",
			"    time.sleep(ex.rateLimit / 1000)",
		].join("\n"),
	},

	pagination:
		"Max 1440 candles per request. Advance `since = candles[-1][0] + 1`. " +
		"Rate limit: 1000 req / min. On 429, back off per Retry-After.",

	knownGotchas: [
		"Spot only — no futures, no margin, no derivatives at all.",
		"No USDT pairs. Primary quote is EUR. Only 11 USDC pairs.",
		"EU-regulated exchange — may restrict non-EU IP addresses.",
		"REST API docs: https://docs.bitvavo.com/#tag/Market-Data/paths/~1{market}~1candles/get",
		"Bulk data portal: none — API-only for historical data.",
	],

	lastVerified: "2026-04-09",
	verificationNotes:
		"BTC/EUR spot 5m, 1440 rows, ccxt 4.4.x.",
};
