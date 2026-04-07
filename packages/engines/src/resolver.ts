import type { EngineName, StrategyMode } from "@quantdesk/shared";

export interface VenueEngines {
	id: string;
	name: string;
	engines: string[];
}

const MODE_TO_ENGINE: Record<StrategyMode, EngineName> = {
	classic: "freqtrade",
	realtime: "nautilus",
};

/**
 * Resolve the engine for a venue + strategy mode.
 *
 * Rules:
 * - If the venue supports the mapped engine (freqtrade for classic, nautilus for realtime), use it.
 * - If the venue only supports "generic", fall back to generic regardless of mode (backtest only, no paper).
 * - Otherwise throw — the mode is not available for this venue.
 */
export function resolveEngine(venue: VenueEngines, mode: StrategyMode): EngineName {
	if (venue.engines.length === 1 && venue.engines[0] === "generic") {
		return "generic";
	}

	const mapped = MODE_TO_ENGINE[mode];
	if (venue.engines.includes(mapped)) {
		return mapped;
	}

	const modes = availableModes(venue);
	throw new Error(
		`Venue ${venue.name} does not support ${mode} strategies. ` +
			`Available modes: ${modes.length > 0 ? modes.join(", ") : "none (backtest-only via generic)"}`,
	);
}

/**
 * Return the strategy modes available for a venue.
 * `generic`-only venues return an empty array (backtest only, no paper).
 */
export function availableModes(venue: VenueEngines): StrategyMode[] {
	const modes: StrategyMode[] = [];
	if (venue.engines.includes("freqtrade")) modes.push("classic");
	if (venue.engines.includes("nautilus")) modes.push("realtime");
	return modes;
}

/**
 * Intersect available modes across multiple venues. Used by the wizard to
 * enable/disable the mode cards once the user has picked venues.
 */
export function availableModesForVenues(venues: VenueEngines[]): StrategyMode[] {
	if (venues.length === 0) return ["classic", "realtime"];
	const sets = venues.map((v) => new Set(availableModes(v)));
	const [first, ...rest] = sets;
	if (!first) return [];
	const result: StrategyMode[] = [];
	for (const mode of first) {
		if (rest.every((s) => s.has(mode))) result.push(mode);
	}
	return result;
}
