/**
 * Approve/reject handler for `[PROPOSE_COMPLETE_EXPERIMENT]` (P4 in
 * `doc/agent/MARKERS.md`).
 *
 * On approve: marks the experiment as completed (memory summary +
 * status=completed) and posts a rule #15 system comment naming the next
 * move (start a new experiment or close the desk). No retrigger.
 *
 * On reject: posts a rule #15 system comment ("Continuing this experiment.
 * Reply with the next direction.") and retriggers the analyst on the
 * current experiment so the loop continues.
 */

import { triggerAgent } from "../agent-trigger.js";
import { systemComment } from "../comments.js";
import { completeExperiment } from "../experiments.js";
import { registerProposalHandler } from "./registry.js";

export function registerCompleteExperimentHandler(): void {
	registerProposalHandler({
		type: "complete_experiment",
		async onApprove({ comment }) {
			await completeExperiment(comment.experimentId);
			await systemComment({
				experimentId: comment.experimentId,
				nextAction: "action",
				content:
					"Experiment closed. Reply with the next direction to start a new experiment, " +
					"or close the desk to finish.",
			});
		},
		async onReject({ comment }) {
			await systemComment({
				experimentId: comment.experimentId,
				nextAction: "action",
				content: "Continuing this experiment. Reply with the next instruction.",
			});
			await triggerAgent(comment.experimentId);
		},
	});
}
