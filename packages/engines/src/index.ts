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
	stopContainer,
	removeContainer,
	listByLabel,
	ensureDockerAvailable,
	quantdeskLabels,
	DockerError,
	type DockerRunOptions,
	type ContainerSummary,
	type RunResult as DockerRunResult,
} from "./docker.js";
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
export { GenericImageMissingError, UnsupportedRuntimeError } from "./generic/adapter.js";
