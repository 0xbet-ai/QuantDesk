import type { VenueGuide } from "./types.js";

export const deribitGuide: VenueGuide = {
	venue: "deribit",
	displayName: "Deribit",

	tldr:
		"Deribit is nautilus-only. Use Nautilus's native Deribit adapter or Tardis " +
		"CSV loader for historical data. For direct API fallback, use the REST " +
		"endpoint `/api/v2/public/get_tradingview_chart_data` for OHLCV.",

	symbolFormat: {
		spot: "BTC_USDC.DERIBIT (nautilus) | BTC_USDC (native REST)",
		linearFutures:
			"BTC-PERPETUAL.DERIBIT, ETH-PERPETUAL.DERIBIT (nautilus perps) | BTC-PERPETUAL (native)\n" +
			"Dated futures: BTC-27JUN25.DERIBIT (nautilus) | BTC-27JUN25 (native)\n" +
			"Options: BTC-27JUN25-100000-C.DERIBIT (nautilus) | BTC-27JUN25-100000-C (native)",
		notes:
			"Deribit is primarily a derivatives exchange — options are the main product. " +
			"Supported currencies: BTC, ETH, USDC, USDT, EURR. " +
			"Spot market limited. Tardis exchange key: `deribit`.",
	},

	recommendedFetch: {
		language: "python",
		library: "nautilus_trader or httpx",
		code: [
			"# Option 1: Tardis CSV (preferred for bulk)",
			"from nautilus_trader.adapters.tardis import TardisCSVDataLoader",
			"trades = TardisCSVDataLoader.load_trades('path/to/trades.csv.gz')",
			"",
			"# Option 2: Direct REST API fallback",
			"import httpx",
			"",
			"url = 'https://www.deribit.com/api/v2/public/get_tradingview_chart_data'",
			"params = {",
			"    'instrument_name': 'BTC-PERPETUAL',",
			"    'resolution': '5',  # minutes",
			"    'start_timestamp': 1704067200000,  # ms epoch",
			"    'end_timestamp': 1704153600000,",
			"}",
			"resp = httpx.get(url, params=params)",
			"data = resp.json()['result']",
			"# Returns: ticks, open, high, low, close, volume, cost",
			"# Paginate: advance start_timestamp to last tick + 1",
		].join("\n"),
	},

	pagination:
		"TradingView chart endpoint returns variable rows depending on time range. " +
		"Advance `start_timestamp` to last tick + 1 (ms). " +
		"Rate limit: 20 req / second (unauthenticated). On 429, back off 1 second.",

	apiDocs: "https://docs.deribit.com/#public-get_tradingview_chart_data",

	knownGotchas: [
		"Options are the primary product — more options than futures/perps.",
		"Perpetual symbol is literally `BTC-PERPETUAL`, not abbreviated.",
		"Timestamps in API are milliseconds.",
		"WebSocket is preferred for real-time data; REST for historical.",
		"Tardis exchange key is `deribit`.",
	],

	lastVerified: "2026-04-09",
	verificationNotes:
		"BTC-PERPETUAL 5m via REST, Tardis CSV trades load verified.",
};
