/**
 * Venue ↔ strategy-mode helpers. Pure logic, no Docker / fs / network.
 *
 * Lives in `@quantdesk/shared` so both the server (engine resolution at
 * desk creation) and the UI (wizard mode picker) can use the same source
 * of truth without the UI having to pull in `@quantdesk/engines`'s Docker
 * code via its barrel.
 *
 * Engine names are an implementation detail of the engine layer. UI code
 * should NEVER inspect `venue.engines` directly — call `availableModes` /
 * `availableModesForVenues` instead. The marker truth table only exposes
 * `strategy_mode` to the user; the engine derivation lives behind these
 * helpers.
 */

import type { StrategyMode } from "./schemas.js";

export interface VenueEngines {
	id: string;
	name: string;
	engines: string[];
}

/**
 * Map a strategy mode to the managed engine name. Kept private to this
 * file — callers want `availableModes` / `availableModesForVenues` /
 * `engineForMode`, not the raw mapping.
 */
const MODE_TO_ENGINE: Record<StrategyMode, string> = {
	classic: "freqtrade",
	realtime: "nautilus",
};

/**
 * Return the managed engine name for a strategy mode. Used by the wizard
 * to filter the strategy catalog ("if user picked classic, only show the
 * matching engine's strategies"). This is the only place outside the
 * engine layer that should know which engine backs which mode.
 */
export function engineForMode(mode: StrategyMode): string {
	return MODE_TO_ENGINE[mode];
}

/**
 * Return the strategy modes available for a venue. `generic`-only venues
 * return an empty array (backtest only, no managed engine).
 */
export function availableModes(venue: VenueEngines): StrategyMode[] {
	const modes: StrategyMode[] = [];
	for (const mode of Object.keys(MODE_TO_ENGINE) as StrategyMode[]) {
		if (venue.engines.includes(MODE_TO_ENGINE[mode])) modes.push(mode);
	}
	return modes;
}

/**
 * Intersect available modes across multiple venues. Used by the wizard to
 * enable/disable mode cards once the user has picked venues. Empty venue
 * list returns every mode (permissive default for the not-yet-picked
 * state).
 */
export function availableModesForVenues(venues: VenueEngines[]): StrategyMode[] {
	if (venues.length === 0) return Object.keys(MODE_TO_ENGINE) as StrategyMode[];
	const sets = venues.map((v) => new Set(availableModes(v)));
	const [first, ...rest] = sets;
	if (!first) return [];
	const result: StrategyMode[] = [];
	for (const mode of first) {
		if (rest.every((s) => s.has(mode))) result.push(mode);
	}
	return result;
}

/**
 * Resolve the managed engine for a (venue, mode) pair. Throws if the
 * venue does not support the requested mode. Used server-side at desk
 * creation; the UI should call `availableModes(forVenues)` instead and
 * never resolve the engine name itself.
 */
export function resolveEngine(venue: VenueEngines, mode: StrategyMode): string {
	if (venue.engines.length === 1 && venue.engines[0] === "generic") {
		return "generic";
	}
	const mapped = MODE_TO_ENGINE[mode];
	if (venue.engines.includes(mapped)) return mapped;
	const modes = availableModes(venue);
	throw new Error(
		`Venue ${venue.name} does not support ${mode} strategies. ` +
			`Available modes: ${modes.length > 0 ? modes.join(", ") : "none (backtest-only via generic)"}`,
	);
}
