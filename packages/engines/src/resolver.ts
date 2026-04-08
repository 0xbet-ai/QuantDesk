/**
 * Re-exports from `@quantdesk/shared/venue-modes` so existing imports
 * (`from "@quantdesk/engines"`) keep working. The single owner is shared
 * so the UI can use the same logic without pulling in Docker code.
 */

export {
	availableModes,
	availableModesForVenues,
	resolveEngine,
	type VenueEngines,
} from "@quantdesk/shared";
