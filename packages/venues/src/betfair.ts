import type { VenueGuide } from "./types.js";

export const betfairGuide: VenueGuide = {
	venue: "betfair",
	displayName: "Betfair",

	tldr:
		"Betfair is nautilus-only. Use Nautilus's native Betfair adapter which " +
		"connects via the Exchange Streaming API. Historical data requires a " +
		"Betfair account and is primarily order book (odds) data, not OHLCV candles.",

	symbolFormat: {
		spot:
			"{market_id}-{selection_id}-{handicap}.BETFAIR (nautilus)\n" +
			"e.g. 1.179082386-235-0.BETFAIR\n" +
			"Native: marketId + selectionId + handicap (Betfair exchange IDs)",
		notes:
			"Sports betting exchange — not a financial exchange. Markets are sporting events. " +
			"Order book is odds-based (back/lay). Uses `betfair-parser` library. " +
			"NOT available through Tardis.",
	},

	recommendedFetch: {
		language: "python",
		library: "nautilus_trader or betfairlightweight",
		code: [
			"# Betfair historical data requires account credentials",
			"# and comes in a unique format (exchange streaming protocol)",
			"",
			"# Option 1: Betfair Historical Data portal (paid subscription)",
			"# https://historicdata.betfair.com/",
			"# Download TAR files with streaming data, then load via Nautilus",
			"",
			"# Option 2: Betfair API-NG for market catalog + prices",
			"import betfairlightweight",
			"",
			"trading = betfairlightweight.APIClient(",
			"    username='...', password='...', app_key='...',",
			"    certs='/path/to/certs'",
			")",
			"trading.login()",
			"",
			"# List market catalog",
			"markets = trading.betting.list_market_catalogue(",
			"    filter={'eventTypeIds': ['1']},  # 1 = Soccer",
			"    market_projection=['MARKET_START_TIME', 'RUNNER_DESCRIPTION'],",
			"    max_results=10,",
			")",
		].join("\n"),
	},

	pagination:
		"API-NG has rate limits per operation type. " +
		"listMarketCatalogue: 200 markets per request. " +
		"Historical data portal: bulk TAR downloads by date. " +
		"On rate limit, back off 1 second.",

	apiDocs: "https://docs.developer.betfair.com/display/1smk3cen4v3lu3yomq5qye0ni/API-NG+Overview",

	knownGotchas: [
		"Sports betting exchange — odds-based order book, not price-based.",
		"Requires Betfair account + API certificates for any data access.",
		"Historical data is a paid subscription at historicdata.betfair.com.",
		"Symbols are market/selection IDs, not human-readable names.",
		"NOT available through Tardis.",
		"Nautilus uses `betfair-parser` for protocol parsing.",
	],

	lastVerified: "2026-04-09",
	verificationNotes:
		"Market catalog listing via betfairlightweight, Nautilus adapter config verified.",
};
