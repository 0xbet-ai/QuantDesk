import type { VenueGuide } from "./types.js";

export const polymarketGuide: VenueGuide = {
	venue: "polymarket",
	displayName: "Polymarket",

	tldr:
		"Polymarket is nautilus-only. Use Nautilus's native Polymarket adapter " +
		"which connects to the CLOB (Central Limit Order Book) API. Historical " +
		"data via CLOB REST endpoint `/prices-history`.",

	symbolFormat: {
		spot:
			"{condition_id}-{token_id}.POLYMARKET (nautilus)\n" +
			"e.g. 0x1234abcd...-12345.POLYMARKET\n" +
			"Native: condition_id + token_id (hex + numeric)",
		notes:
			"Prediction market — not a traditional exchange. Markets are binary outcomes. " +
			"Symbol IDs are blockchain condition/outcome identifiers, not ticker symbols. " +
			"NOT available through Tardis.",
	},

	recommendedFetch: {
		language: "python",
		library: "nautilus_trader or httpx",
		code: [
			"# Polymarket CLOB API for historical prices",
			"import httpx",
			"",
			"# Get market info first",
			"url = 'https://clob.polymarket.com/markets'",
			"# or specific market: /markets/{condition_id}",
			"",
			"# Historical prices",
			"url = 'https://clob.polymarket.com/prices-history'",
			"params = {",
			"    'market': '<condition_id>',",
			"    'interval': 'max',   # 1d, 1w, 1m, 3m, max",
			"    'fidelity': 60,      # seconds between data points",
			"}",
			"resp = httpx.get(url, params=params)",
			"prices = resp.json()['history']",
			"# Returns: [{t: timestamp, p: price}, ...]",
		].join("\n"),
	},

	pagination:
		"Prices-history returns full range in one response (no pagination needed). " +
		"Fidelity param controls granularity (seconds between points). " +
		"Rate limit: varies, be conservative with 1 req / second.",

	knownGotchas: [
		"Prediction market — binary outcomes (YES/NO tokens), not traditional trading pairs.",
		"Symbols are hex condition IDs + numeric token IDs, not human-readable tickers.",
		"Markets are created per event and expire — no perpetual instruments.",
		"NOT available through Tardis — Polymarket API only.",
		"Order book is the primary data type (price levels for YES/NO tokens).",
		"CLOB API docs: https://docs.polymarket.com/",
	],

	lastVerified: "2026-04-09",
	verificationNotes:
		"Prices-history endpoint verified for a sample market, 60s fidelity.",
};
