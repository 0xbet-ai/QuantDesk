import type { VenueGuide } from "./types.js";

export const interactiveBrokersGuide: VenueGuide = {
	venue: "interactive_brokers",
	displayName: "Interactive Brokers",

	tldr:
		"IB is nautilus-only. Use Nautilus's native IB adapter which connects via " +
		"TWS/Gateway API. Historical bars are fetched through the IB API — no " +
		"public REST endpoint. Requires IB Gateway running locally.",

	symbolFormat: {
		spot:
			"AAPL.INTERACTIVE_BROKERS (equity) | EUR/USD.INTERACTIVE_BROKERS (forex)\n" +
			"BTC/USD.INTERACTIVE_BROKERS (crypto)",
		linearFutures:
			"ESZ5.INTERACTIVE_BROKERS (futures, root+monthcode+year) | " +
			"AAPL  251219C00200000.INTERACTIVE_BROKERS (options, OCC padded format)",
		notes:
			"Multi-asset class: stocks, futures, options, forex, crypto, CFDs. " +
			"Uses IB_SIMPLIFIED symbology by default (also supports IB_RAW). " +
			"Python-only adapter (no Rust layer). Requires IB Gateway/TWS running. " +
			"NOT available through Tardis.",
	},

	recommendedFetch: {
		language: "python",
		library: "nautilus_trader.adapters.interactive_brokers",
		code: [
			"# IB historical data is fetched through the TWS/Gateway API,",
			"# not a public REST endpoint. The Nautilus IB adapter wraps this.",
			"#",
			"# Typical backtest setup:",
			"from nautilus_trader.adapters.interactive_brokers.config import (",
			"    InteractiveBrokersDataClientConfig,",
			")",
			"",
			"data_config = InteractiveBrokersDataClientConfig(",
			"    ibg_host='127.0.0.1',",
			"    ibg_port=4002,        # IB Gateway paper trading port",
			"    ibg_client_id=1,",
			")",
			"",
			"# Historical bars are requested via:",
			"# reqHistoricalData(contract, endDateTime, durationStr, barSizeSetting, ...)",
			"# Supported bar sizes: 1 secs, 5 secs, 10 secs, 15 secs, 30 secs,",
			"#   1 min, 2 mins, 3 mins, 5 mins, 10 mins, 15 mins, 20 mins, 30 mins,",
			"#   1 hour, 2 hours, 3 hours, 4 hours, 8 hours, 1 day, 1 week, 1 month",
		].join("\n"),
	},

	pagination:
		"IB API pacing rules: max 60 historical data requests in 10 minutes. " +
		"Identical requests within 15 seconds are rejected. " +
		"Max duration depends on bar size (e.g., 1 sec bars → max 1800 secs). " +
		"On pacing violation, wait 10 minutes.",

	apiDocs: "https://ibkrcampus.com/campus/ibkr-api-page/twsapi-doc/",

	knownGotchas: [
		"Requires IB Gateway or TWS running locally — no public REST API.",
		"Paper trading port: 4002. Live trading port: 4001.",
		"IB has strict pacing rules — 60 requests per 10 minutes for historical data.",
		"Multi-asset class (stocks, futures, options, forex, crypto) — symbology varies.",
		"NOT available through Tardis — IB data stays within IB ecosystem.",
		"Futures use month codes: F(Jan), G(Feb), H(Mar), J(Apr), K(May), M(Jun), N(Jul), Q(Aug), U(Sep), V(Oct), X(Nov), Z(Dec).",
	],

	lastVerified: "2026-04-09",
	verificationNotes:
		"AAPL 5min bars via IB Gateway paper port 4002, Nautilus IB adapter.",
};
