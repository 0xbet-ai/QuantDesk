export { formatAgentMarkersForDisplay, stripAgentMarkers } from "./agent-markers.js";

export { quantdeskConfigSchema } from "./config-schema.js";
export type { QuantDeskConfig } from "./config-schema.js";

export type DeploymentMode = "local_trusted" | "authenticated";

// Phase 27d — legacy marker types kept here as thin shims so call sites
// that still reference them compile while the transition settles.
export interface DataFetchRequest {
	exchange: string;
	pairs: string[];
	timeframe: string;
	days: number;
	tradingMode?: "spot" | "futures" | "margin";
	rationale?: string;
}
export interface RmVerdict {
	verdict: "approve" | "reject";
	reason: string;
}

export {
	adapterConfigSchema,
	engineNameSchema,
	normalizedResultSchema,
	paperStatusSchema,
	runStatusSchema,
	strategyModeSchema,
	tradeEntrySchema,
} from "./schemas.js";

export type {
	AdapterConfig,
	EngineName,
	NormalizedResult,
	PaperStatus,
	RunStatus,
	StrategyMode,
	TradeEntry,
} from "./schemas.js";

export {
	deriveExternalMountLabel,
	EXTERNAL_MOUNT_LABEL_PATTERN,
	SEED_COPY_SKIP_NAMES,
	SEED_PATH_ABSOLUTE_DENY,
	SEED_PATH_HOME_DENY,
	SEED_PATH_MAX_BYTES,
} from "./seed-path.js";

export {
	availableModes,
	availableModesForVenues,
	engineForMode,
	resolveEngine,
	type VenueEngines,
} from "./venue-modes.js";
