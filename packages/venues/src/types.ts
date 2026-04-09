/**
 * Schema for a per-venue Path B fetch guide.
 *
 * A guide is a small, opinionated cheatsheet the analyst agent consults
 * when the engine's bundled downloader (Path A) fails and the agent has
 * to fetch OHLCV data itself. One guide = one venue = one verified
 * recipe.
 *
 * See `packages/venues/README.md` for the editorial guidelines and
 * `src/_example.ts` for a starting template.
 */

export interface VenueGuide {
	/**
	 * Lowercase venue id matching the string stored in `desks.venues[]`
	 * (e.g. `"binance"`, `"bybit"`, `"hyperliquid"`). Used as the
	 * registry key in `src/index.ts`.
	 */
	venue: string;

	/**
	 * Human-friendly display name used in the rendered markdown header.
	 */
	displayName: string;

	/**
	 * One paragraph. The shortest known-good route to OHLCV data when
	 * Path A fails. Be prescriptive — the agent will follow this
	 * literally. Do NOT hedge with "you could also try X".
	 */
	tldr: string;

	/**
	 * How this venue spells its pairs, per market type. Omit a field if
	 * the venue doesn't have that market.
	 */
	symbolFormat: {
		spot?: string;
		linearFutures?: string;
		inverseFutures?: string;
		/** Free-form extra notes (e.g. settlement-currency rules). */
		notes?: string;
	};

	/**
	 * Bulk data download portal, if this venue offers one. Venues with
	 * a portal get an extra step in the fetch priority chain (between
	 * engine downloader and API pagination). `null` / omitted = no portal.
	 */
	bulkDownload?: {
		/** Direct URL to the portal or file listing. */
		url: string;
		/** File format, e.g. `"zip/csv"`, `"gzip/csv"`, `"lz4"`. */
		format: string;
		/** What's available, e.g. `"1s klines, trades, aggTrades"`. */
		dataTypes: string;
		/** Extra caveats (e.g. "futures limited to 30 days"). */
		notes?: string;
	};

	/**
	 * Exactly one recommended fetch snippet. Must be copy-paste runnable
	 * (after filling in symbol/timeframe). Listing multiple options is
	 * an anti-pattern — the agent will pick the wrong one.
	 */
	recommendedFetch: {
		language: "python" | "typescript" | "bash";
		/** e.g. `"ccxt>=4.3"`, `"httpx"`, `"hyperliquid-python-sdk==0.x"`. */
		library: string;
		code: string;
	};

	/**
	 * Direct REST API docs URL for this venue's candlestick/OHLCV
	 * endpoint. Used as the last-resort fetch tier before reporting
	 * failure to the user.
	 */
	apiDocs: string | string[];

	/**
	 * Pagination rules: max candles per request, how to advance the
	 * cursor/since parameter, server-side rate limits, 429 handling.
	 */
	pagination: string;

	/**
	 * Landmines specific to this venue: missing timeframes, symbol
	 * aliases, timestamp unit quirks, auth-required-for-public data, etc.
	 * Each bullet is rendered as a list item.
	 */
	knownGotchas: string[];

	/**
	 * `YYYY-MM-DD` — the date this guide was last empirically verified
	 * against the live venue. Guides older than ~6 months should be
	 * re-verified before trusting.
	 */
	lastVerified: string;

	/**
	 * One-sentence description of what was tested for `lastVerified`:
	 * pair, timeframe, library version. Stale guides are traps — this
	 * field makes drift visible.
	 */
	verificationNotes: string;
}
