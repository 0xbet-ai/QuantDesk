/**
 * Approve/reject handler for `[PROPOSE_NEW_EXPERIMENT] <title>` (P3 in
 * `doc/agent/MARKERS.md`).
 *
 * On approve: completes the current experiment (memory summary + status =
 * completed), creates a new experiment with the proposed title, then
 * retriggers the analyst on the new experiment.
 *
 * On reject: posts a rule #15 system comment naming the next move and
 * retriggers the analyst on the current experiment so the loop continues.
 */

import { triggerAgent } from "../agent-trigger.js";
import { systemComment } from "../comments.js";
import { completeAndCreateNewExperiment } from "../experiments.js";
import { registerProposalHandler } from "./registry.js";

export function registerNewExperimentHandler(): void {
	registerProposalHandler({
		type: "new_experiment",
		async onApprove({ comment, proposal }) {
			const data = proposal.data as { value?: string } | null;
			const title = data?.value?.trim();
			if (!title) {
				throw new Error("PROPOSE_NEW_EXPERIMENT proposal is missing a title value");
			}
			const newExperiment = await completeAndCreateNewExperiment({
				currentExperimentId: comment.experimentId,
				newTitle: title,
			});
			await triggerAgent(newExperiment.id);
		},
		async onReject({ comment }) {
			await systemComment({
				experimentId: comment.experimentId,
				nextAction: "action",
				content:
					"Staying in the current experiment. Reply with a different direction or " +
					"propose the next experiment again later.",
			});
			await triggerAgent(comment.experimentId);
		},
	});
}
