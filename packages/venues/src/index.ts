/**
 * `@quantdesk/venues` — per-venue data-fetch guide registry.
 *
 * Consumers (currently only the server's workspace bootstrap) call
 * `getVenueGuide(venue)` to look up a guide by lowercase venue id,
 * then `renderVenueGuideMarkdown(guide)` to produce the markdown the
 * analyst agent reads inside its workspace.
 *
 * Guides are plain TS modules so they get bundled alongside the rest
 * of the server code — no filesystem catalog to ship, no runtime path
 * resolution, no sandbox carve-outs. Adding a new venue:
 *
 *   1. Create `src/<venue>.ts` exporting a `VenueGuide`.
 *   2. Import it here and register it in `REGISTRY`.
 *   3. Verify empirically (see README), commit.
 */

import type { VenueGuide } from "./types.js";

import { binanceGuide } from "./binance.js";
import { bybitGuide } from "./bybit.js";
import { okxGuide } from "./okx.js";
import { krakenGuide } from "./kraken.js";
import { gateIoGuide } from "./gate_io.js";
import { kucoinGuide } from "./kucoin.js";
import { htxGuide } from "./htx.js";
import { bitgetGuide } from "./bitget.js";
import { bitmartGuide } from "./bitmart.js";
import { bingxGuide } from "./bingx.js";
import { bitvavoGuide } from "./bitvavo.js";
import { hyperliquidGuide } from "./hyperliquid.js";
import { bitmexGuide } from "./bitmex.js";
import { deribitGuide } from "./deribit.js";
import { dydxGuide } from "./dydx.js";
import { interactiveBrokersGuide } from "./interactive_brokers.js";
import { polymarketGuide } from "./polymarket.js";
import { betfairGuide } from "./betfair.js";

const REGISTRY: Record<string, VenueGuide> = {
	binance: binanceGuide,
	bybit: bybitGuide,
	okx: okxGuide,
	kraken: krakenGuide,
	gate_io: gateIoGuide,
	kucoin: kucoinGuide,
	htx: htxGuide,
	bitget: bitgetGuide,
	bitmart: bitmartGuide,
	bingx: bingxGuide,
	bitvavo: bitvavoGuide,
	hyperliquid: hyperliquidGuide,
	bitmex: bitmexGuide,
	deribit: deribitGuide,
	dydx: dydxGuide,
	interactive_brokers: interactiveBrokersGuide,
	polymarket: polymarketGuide,
	betfair: betfairGuide,
};

/**
 * Look up a guide by venue id. Case-insensitive. Returns `null` when
 * no guide is registered — callers must treat missing guides as
 * "fall back to the generic prompt instructions", not as an error.
 */
export function getVenueGuide(venue: string): VenueGuide | null {
	const key = venue.trim().toLowerCase();
	if (!key) return null;
	return REGISTRY[key] ?? null;
}

/**
 * Render a guide as the markdown file that will be seeded into a
 * desk workspace at `.quantdesk/PATH_B_FETCH_<venue>.md`. The
 * analyst reads this exact file; the rendering step is the only
 * place the on-disk format is defined.
 */
export function renderVenueGuideMarkdown(guide: VenueGuide): string {
	const symLines: string[] = [];
	if (guide.symbolFormat.spot) {
		symLines.push(`- **Spot:** ${guide.symbolFormat.spot}`);
	}
	if (guide.symbolFormat.linearFutures) {
		symLines.push(`- **Linear futures:** ${guide.symbolFormat.linearFutures}`);
	}
	if (guide.symbolFormat.inverseFutures) {
		symLines.push(`- **Inverse futures:** ${guide.symbolFormat.inverseFutures}`);
	}
	const symNotes = guide.symbolFormat.notes ? `\n\n${guide.symbolFormat.notes}` : "";

	const gotchas = guide.knownGotchas.map((g) => `- ${g}`).join("\n");

	// Build fetch priority section
	const priorities: string[] = [];
	let num = 1;

	if (guide.bulkDownload) {
		const bd = guide.bulkDownload;
		const bdNotes = bd.notes ? ` — ${bd.notes}` : "";
		priorities.push(
			`${num}. **Bulk portal** → ${bd.url} (${bd.format}: ${bd.dataTypes}${bdNotes})`,
		);
		num++;
	}

	priorities.push(
		`${num}. **${guide.recommendedFetch.library}** — paginated fetch (see snippet below)`,
	);
	num++;

	const apiDocs = Array.isArray(guide.apiDocs) ? guide.apiDocs : [guide.apiDocs];
	const apiDocsStr = apiDocs.map((d) => `  - ${d}`).join("\n");
	priorities.push(`${num}. **Direct REST API** — last resort\n${apiDocsStr}`);
	num++;
	priorities.push(`${num}. **Report to user** if all above fail`);

	return `# Data fetch guide — ${guide.displayName}

> Venue id: \`${guide.venue}\`
> Last verified: \`${guide.lastVerified}\` — ${guide.verificationNotes}

This file was seeded into your workspace because your desk uses this
venue. Use it when writing your fetcher script. Try each method in
priority order — advance to the next only on failure.

## Data fetch priority

${priorities.join("\n")}

## TL;DR

${guide.tldr}

## Symbol format

${symLines.join("\n")}${symNotes}

## Recommended fetch method

Library: \`${guide.recommendedFetch.library}\`

\`\`\`${guide.recommendedFetch.language}
${guide.recommendedFetch.code}
\`\`\`

## Pagination

${guide.pagination}

## Known gotchas

${gotchas}
`;
}

export type { VenueGuide } from "./types.js";
