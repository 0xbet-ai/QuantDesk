export { getAdapter } from "./registry.js";
export {
	resolveEngine,
	availableModes,
	availableModesForVenues,
	type VenueEngines,
} from "./resolver.js";
export { ENGINE_IMAGES, getEngineImage } from "./images.js";
export {
	pullImage,
	hasImage,
	runContainer,
	runDetached,
	execInContainer,
	logsFrom,
	followLogs,
	stopContainer,
	removeContainer,
	listByLabel,
	ensureDockerAvailable,
	quantdeskLabels,
	DockerError,
	type DockerRunOptions,
	type ContainerSummary,
	type LogStreamHandle,
	type LogStreamOptions,
	type RunResult as DockerRunResult,
} from "./docker.js";
export { deriveMetrics } from "./metrics.js";
export type {
	BacktestConfig,
	BacktestResult,
	DataConfig,
	DataRef,
	EngineAdapter,
	NormalizedResult,
	PaperConfig,
	PaperHandle,
	PaperStatus,
	TradeEntry,
} from "./types.js";
export { UnsupportedRuntimeError } from "./generic/adapter.js";
export {
	setEngineRuntimeConfig,
	getEngineRuntimeConfig,
	resolveImage,
	formatMemory,
	type EngineResources,
	type EngineRuntimeConfig,
} from "./runtime-config.js";
