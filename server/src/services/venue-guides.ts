/**
 * Per-venue Path B fetch-guide loader.
 *
 * Source catalog lives at `packages/venues/<venue>/path-b-fetch.md`
 * (see `packages/venues/README.md`). On desk creation, `initWorkspace`
 * calls `loadVenueGuides(desk.venues)` and writes the returned files
 * into the workspace at `.quantdesk/PATH_B_FETCH_<venue>.md`.
 *
 * Design rules:
 *   - Missing venue = skip, no error. The agent falls back to the
 *     generic Path B instructions in `mode-classic.ts`.
 *   - Directories starting with `_` are ignored (used for templates
 *     and examples).
 *   - Venue IDs are normalized to lowercase for the lookup.
 *   - Pure filesystem read — no DB, no network, no side effects beyond
 *     returning file contents.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Repo-root-relative path to the venue catalog. Detected from this
 * file's own URL so it works in both `src/` (tsx dev) and built
 * output. Layout:
 *   <repoRoot>/server/src/services/venue-guides.ts → climb 4 levels.
 */
const VENUES_ROOT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../../packages/venues",
);

export interface VenueGuide {
	venue: string;
	/** Filename to write into the workspace (without directory prefix). */
	workspaceFilename: string;
	/** File contents to write verbatim. */
	content: string;
}

/**
 * Load Path B fetch guides for every venue in `venues` that has one in
 * the catalog. Unknown venues are silently skipped. The return order
 * matches the input order; duplicates are collapsed.
 */
export function loadVenueGuides(venues: readonly string[]): VenueGuide[] {
	const seen = new Set<string>();
	const out: VenueGuide[] = [];
	for (const raw of venues) {
		const venue = raw.trim().toLowerCase();
		if (!venue || venue.startsWith("_") || seen.has(venue)) continue;
		seen.add(venue);
		const guidePath = join(VENUES_ROOT, venue, "path-b-fetch.md");
		if (!existsSync(guidePath)) continue;
		const content = readFileSync(guidePath, "utf8");
		out.push({
			venue,
			workspaceFilename: `PATH_B_FETCH_${venue}.md`,
			content,
		});
	}
	return out;
}
