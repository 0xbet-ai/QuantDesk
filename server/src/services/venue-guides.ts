/**
 * Per-venue Path B fetch-guide loader.
 *
 * Thin wrapper around `@quantdesk/venues`: for each venue id on a
 * desk, look up the registered guide (if any) and render it into a
 * workspace-ready markdown file. Missing venues are silently skipped;
 * the agent falls back to the generic Path B instructions in the
 * mode-classic prompt block.
 *
 * Guides are plain TS modules in the `@quantdesk/venues` package so
 * they ship bundled with the server — no filesystem catalog to
 * resolve at runtime.
 */

import { getVenueGuide, renderVenueGuideMarkdown } from "@quantdesk/venues";

export interface VenueGuideFile {
	venue: string;
	/** Filename to write into `<workspace>/.quantdesk/`. */
	workspaceFilename: string;
	/** Rendered markdown body. */
	content: string;
}

/**
 * Look up Path B fetch guides for every venue on a desk. Returns the
 * rendered files in the input order; duplicate venue ids are
 * collapsed. Venues without a registered guide are omitted.
 */
export function loadVenueGuides(venues: readonly string[]): VenueGuideFile[] {
	const seen = new Set<string>();
	const out: VenueGuideFile[] = [];
	for (const raw of venues) {
		const venue = raw.trim().toLowerCase();
		if (!venue || seen.has(venue)) continue;
		seen.add(venue);
		const guide = getVenueGuide(venue);
		if (!guide) continue;
		out.push({
			venue,
			workspaceFilename: `PATH_B_FETCH_${venue}.md`,
			content: renderVenueGuideMarkdown(guide),
		});
	}
	return out;
}
