import freqtradeStrategies from "../../../strategies/freqtrade.json" with { type: "json" };
import nautilusStrategies from "../../../strategies/nautilus.json" with { type: "json" };

/**
 * Strategy catalog service.
 *
 * Source of truth is the two JSON files under `/strategies/` (checked
 * into the repo). They used to be mirrored into a `strategy_catalog`
 * Postgres table via `db:seed`, but that added a redundant round-trip
 * and meant edits to the JSON didn't show up until somebody remembered
 * to re-seed. The catalog is small and immutable at runtime, so reading
 * it straight from disk at module-init is simpler and always current.
 *
 * Shape note: the JSON files are snake_case (`default_params`) to match
 * the upstream freqtrade/nautilus conventions; the public `Strategy`
 * type is camelCase to match every other server ↔ UI contract. The
 * one-time map at module load time handles the translation.
 */

interface RawStrategyEntry {
	id: string;
	name: string;
	category: string;
	difficulty: string;
	description: string;
	summary?: string;
	indicators: string[];
	default_params: Record<string, unknown>;
	timeframes: string[];
	engine: string;
	source?: string;
}

export interface Strategy {
	id: string;
	name: string;
	category: string;
	difficulty: string;
	description: string;
	summary: string | null;
	indicators: string[];
	defaultParams: Record<string, unknown>;
	timeframes: string[];
	engine: string;
	source: string | null;
}

const CATALOG: Strategy[] = [
	...(freqtradeStrategies as RawStrategyEntry[]),
	...(nautilusStrategies as RawStrategyEntry[]),
].map((entry) => ({
	id: entry.id,
	name: entry.name,
	category: entry.category,
	difficulty: entry.difficulty,
	description: entry.description,
	summary: entry.summary ?? null,
	indicators: entry.indicators,
	defaultParams: entry.default_params,
	timeframes: entry.timeframes,
	engine: entry.engine,
	source: entry.source ?? null,
}));

export async function listStrategies(engine?: string): Promise<Strategy[]> {
	if (engine) return CATALOG.filter((s) => s.engine === engine);
	return CATALOG;
}

export async function getStrategy(id: string): Promise<Strategy | null> {
	return CATALOG.find((s) => s.id === id) ?? null;
}
