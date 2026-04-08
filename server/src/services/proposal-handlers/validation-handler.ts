/**
 * Approve/reject handler for `[PROPOSE_VALIDATION]` (P2 in
 * `doc/agent/MARKERS.md`). The single sanctioned path that wakes the
 * Risk Manager (see ROLES.md).
 *
 * On approve: dispatches a fresh agent turn against the desk's
 * `risk_manager` session (lazily created on first use). The runner picks
 * the role from the session row and uses `buildRiskManagerPrompt`.
 *
 * On reject: posts a rule #15 system comment naming the next move and
 * retriggers the analyst on the current experiment.
 *
 * No other code path is allowed to wake the Risk Manager — phase 03's
 * markers-spec test enforces this single-source rule by grepping for
 * marker references in agent-trigger.ts.
 */

import { triggerAgent } from "../agent-trigger.js";
import { systemComment } from "../comments.js";
import { registerProposalHandler } from "./registry.js";

export function registerValidationHandler(): void {
	registerProposalHandler({
		type: "validation",
		async onApprove({ comment }) {
			await triggerAgent(comment.experimentId, "risk_manager");
		},
		async onReject({ comment }) {
			await systemComment({
				experimentId: comment.experimentId,
				nextAction: "action",
				content:
					"Validation skipped. Reply with 'validate' to re-request, or continue with " +
					"the next instruction.",
			});
			await triggerAgent(comment.experimentId);
		},
	});
}
