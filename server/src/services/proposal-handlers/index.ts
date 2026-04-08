/**
 * Barrel that registers every proposal handler at server boot.
 * New handlers (phases 05–07, 11) append themselves here.
 */

import { registerCompleteExperimentHandler } from "./complete-experiment-handler.js";
import { registerDataFetchHandler } from "./data-fetch-handler.js";
import { registerNewExperimentHandler } from "./new-experiment-handler.js";
import { registerValidationHandler } from "./validation-handler.js";

let registered = false;

export function registerAllProposalHandlers(): void {
	if (registered) return;
	registered = true;
	registerDataFetchHandler();
	registerNewExperimentHandler();
	registerCompleteExperimentHandler();
	registerValidationHandler();
}
