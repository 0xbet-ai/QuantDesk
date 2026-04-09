/**
 * Template / example — **not** registered in `index.ts`.
 *
 * Copy this file to `src/<venue-id>.ts`, replace every field with
 * verified, venue-specific content, then add the export to the
 * registry in `src/index.ts`. Filenames starting with `_` are
 * conventionally skipped; this file is here purely as a starting shape.
 *
 * Read `packages/venues/README.md` before editing.
 */

import type { VenueGuide } from "./types.js";

export const exampleGuide: VenueGuide = {
	venue: "example",
	displayName: "Example Exchange",

	tldr:
		"One paragraph describing the shortest known-good route to OHLCV" +
		" data when the engine's bundled downloader fails for this venue." +
		" Be prescriptive — the agent will follow this literally.",

	symbolFormat: {
		spot: "BTC/USDT (ccxt) ↔ BTCUSDT (native REST)",
		linearFutures: "BTC/USDT:USDT (ccxt) ↔ BTCUSDT (native REST)",
		notes:
			"Replace with real mapping rules. Include settlement-currency" +
			" behaviour if the venue has more than one linear contract per base.",
	},

	bulkDownload: {
		url: "https://data.example.com/",
		format: "zip/csv",
		dataTypes: "klines, trades, orderbook",
		notes: "Remove this block if the venue has no bulk portal.",
	},

	recommendedFetch: {
		language: "python",
		library: "ccxt>=4.3",
		code: [
			"import ccxt",
			"",
			"ex = ccxt.example({'enableRateLimit': True})",
			"ex.load_markets()",
			"candles = ex.fetch_ohlcv(",
			"    'BTC/USDT:USDT',",
			"    timeframe='5m',",
			"    since=..., limit=1000,",
			")",
		].join("\n"),
	},

	pagination:
		"Max N candles per request. Advance with `since = candles[-1][0] + 1`." +
		" Server-side rate limit: M req / S seconds. On 429, back off for" +
		" the `Retry-After` value and retry the same page.",

	apiDocs: "https://docs.example.com/market-data/candlesticks",

	knownGotchas: [
		"Describe a real landmine here (e.g. 1m candles only available after 2020-01-01).",
		"Timestamp unit quirks (ms vs. s).",
		"Any public data that unexpectedly requires auth.",
	],

	lastVerified: "YYYY-MM-DD",
	verificationNotes:
		"Describe exactly what was run: pair, timeframe, library version," +
		" expected row count. Stale guides are worse than no guide.",
};
