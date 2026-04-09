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
/**
 * Preferred managed engine per mode. When the venue supports this
 * engine we use it directly; otherwise the engine resolves to
 * `generic` as an auto-fallback (see `resolveEngine`).
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
 * Every venue supports every mode — if the preferred managed engine
 * isn't available for the venue, the engine falls back to `generic`
 * at resolve time. The wizard's mode picker is therefore always
 * permissive; there are no disabled cards.
 */
export function availableModes(_venue: VenueEngines): StrategyMode[] {
	return Object.keys(MODE_TO_ENGINE) as StrategyMode[];
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
/**
 * Resolve the engine for a (venue, mode) pair. Uses the preferred
 * managed engine when the venue supports it, otherwise falls back to
 * `generic` so the agent writes both the strategy and the entrypoint.
 * Never throws — every (venue, mode) combination is resolvable.
 */
export function resolveEngine(venue: VenueEngines, mode: StrategyMode): string {
	const preferred = MODE_TO_ENGINE[mode];
	if (venue.engines.includes(preferred)) return preferred;
	return "generic";
}
