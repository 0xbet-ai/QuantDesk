/**
 * Dead-end guard (CLAUDE.md rule #15 enforcement, phase 14).
 *
 * If an agent turn ends without emitting any action marker AND its
 * resultText is a bare acknowledgment ("OK", "Sure", "Understood", "Sorry,
 * I cannot proceed", or any short plain-text wrap-up), the user is left
 * staring at the desk with nothing to click. That is the exact dead-end
 * rule #15 forbids.
 *
 * This module owns one job: detect that situation and force the agent to
 * try again. It posts a system comment naming the violation and returns
 * `true` so the orchestration layer (`agent-trigger.ts`) knows to
 * re-trigger the agent. A per-experiment counter caps the rescue loop at
 * `MAX_RESCUES` so a permanently broken agent cannot burn unbounded LLM
 * spend; once the cap is hit the guard escalates to the user with a
 * specific multiple-choice prompt and stops re-triggering.
 *
 * SRP: this module does NOT
 *   - decide what an "action marker" is (it asks the caller via `hadMarker`),
 *   - retrigger the agent itself (the caller does that),
 *   - handle non-dead-end failures (data-fetch, backtest, etc. — those have
 *     their own handlers and naturally include action verbs in the failure
 *     comment, so the agent already knows what to do next).
 */

import { systemComment } from "./comments.js";

const MAX_RESCUES = 8;

/** Track consecutive dead-end rescues per experiment so we can cap. */
const rescueCount = new Map<string, number>();

/**
 * Reset the rescue counter for an experiment. Call this whenever the agent
 * produces a real action marker so the next dead-end starts fresh instead
 * of inheriting an old streak.
 */
export function resetDeadEndRescueCounter(experimentId: string): void {
	rescueCount.delete(experimentId);
}

/**
 * Heuristic: is `resultText` a bare acknowledgment with no real action?
 *
 * "Bare ack" = short text (≤ 240 chars after trimming) that consists
 * primarily of acknowledgment words / apologies / generic stopping
 * language. We deliberately under-match here: real responses are usually
 * either long, contain technical detail, or end with a question — so the
 * false-positive risk is low. False negatives (a long apology that we miss)
 * still get caught next turn when the user notices nothing happened.
 */
export function looksLikeBareAck(resultText: string | null | undefined): boolean {
	if (!resultText) return true;
	const trimmed = resultText.trim();
	if (trimmed.length === 0) return true;
	if (trimmed.length > 240) return false;
	// If it ends with a question mark it is at least asking the user something,
	// which satisfies rule 15(b). Not a dead end.
	if (/[?？]\s*$/.test(trimmed)) return false;
	// Must start with or contain only ack-like phrases.
	const ackPattern =
		/^(ok|okay|sure|fine|alright|understood|got it|noted|sorry|apolog|i (?:will|'ll) stop|i cannot|i can't|let me know|thanks|done)\b/i;
	return ackPattern.test(trimmed);
}

interface RescueArgs {
	experimentId: string;
	resultText: string | null | undefined;
	hadMarker: boolean;
}

/**
 * Decide whether the just-finished turn is a dead end and, if so, post a
 * forcing system comment. Returns `true` when the caller should re-trigger
 * the agent, `false` when no action is needed (either it was not a dead
 * end, or the rescue cap has been hit).
 */
export async function maybeRescueDeadEnd({
	experimentId,
	resultText,
	hadMarker,
}: RescueArgs): Promise<boolean> {
	if (hadMarker) {
		resetDeadEndRescueCounter(experimentId);
		return false;
	}
	if (!looksLikeBareAck(resultText)) {
		// Not a dead end — the agent at least produced substantive prose. The
		// user can still reply manually. Reset the counter so a future genuine
		// dead end starts from zero.
		resetDeadEndRescueCounter(experimentId);
		return false;
	}

	const current = rescueCount.get(experimentId) ?? 0;
	if (current >= MAX_RESCUES) {
		// Cap reached — stop the rescue loop and escalate to the user with a
		// specific multiple-choice prompt that satisfies rule 15(b) directly.
		await systemComment({
			experimentId,
			nextAction: "action",
			content:
				`Agent has produced ${MAX_RESCUES} consecutive dead-end turns and ` +
				"the dead-end guard is giving up to avoid burning more budget. " +
				"Please choose how to proceed:\n\n" +
				"  (A) Reply with new instructions describing a different approach.\n" +
				"  (B) Open the desk Settings and switch to a different venue or " +
				"strategy mode.\n" +
				"  (C) Delete this experiment and start a new one.\n\n" +
				"The agent will not auto-retry until you reply.",
		});
		resetDeadEndRescueCounter(experimentId);
		return false;
	}

	rescueCount.set(experimentId, current + 1);
	await systemComment({
		experimentId,
		nextAction: "retrigger",
		content:
			`Dead-end guard (rescue ${current + 1}/${MAX_RESCUES}): your previous ` +
			"turn ended without an action marker. This is a CLAUDE.md rule #15 " +
			"violation. You MUST end your next turn with a valid action marker " +
			"(a proposal with new parameters, a backtest request, etc.) or a " +
			"specific multiple-choice question to the user with concrete " +
			"labelled options. Do not output another bare acknowledgment.",
	});
	return true;
}
