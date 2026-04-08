/**
 * `analyst.failure-escalation` — ralph-loop persistence pressure injected
 * into the analyst prompt when the comment thread shows recent consecutive
 * failure system comments.
 *
 * Marker-agnostic: any system comment whose body matches the failure
 * pattern counts, no matter which lifecycle stage produced it (data-fetch,
 * backtest, validation, etc.).
 */

import type { CommentContext } from "./types.js";

/**
 * Count consecutive failure system comments at the *tail* of the comment
 * thread. Stops counting at the first non-failure comment so a single old
 * failure doesn't poison every future turn.
 *
 * Walking rules:
 * - failure system comment → increment streak, continue
 * - "Downloaded …" / "Reusing existing dataset" / "Backtest run #N completed"
 *   → success marker, return current streak (the loop is over)
 * - any other system comment (progress like "Downloading …") → transparent,
 *   skip without affecting the streak
 * - non-system comment (user / analyst / risk_manager) → reset point,
 *   return current streak
 */
export function countRecentFailureStreak(comments: CommentContext[]): number {
	let n = 0;
	for (let i = comments.length - 1; i >= 0; i--) {
		const c = comments[i]!;
		if (c.author !== "system") return n;
		if (/\b(?:fail(?:ed|ure)?|error)\b/i.test(c.content)) {
			n++;
			continue;
		}
		if (
			/\b(?:downloaded|reusing existing dataset|backtest run #\d+ completed)\b/i.test(c.content)
		) {
			return n;
		}
		// Neutral progress comment → skip without affecting the streak.
	}
	return n;
}

/**
 * Build the persistence-pressure block injected at the top of the analyst
 * prompt when there is a recent failure streak. Returns an empty string
 * when `streak === 0` so the orchestrator can omit the section entirely.
 */
export function buildFailureEscalationBlock(streak: number): string {
	if (streak === 0) return "";
	return `## RECENT FAILURE STREAK: ${streak}

GIVING UP IS NOT AN OPTION. The previous ${streak} attempt(s) failed. You
are in a retry loop and the server WILL re-trigger you until you produce a
valid action marker. Bare acknowledgments in ANY language — "OK", "Sure",
"Sorry", "I'll stop here", "Understood", or any plain-text wrap-up without
a marker — are SPEC VIOLATIONS (CLAUDE.md rule #15) and will be
auto-rejected by the server's dead-end guard, which will then re-prompt
you with the same situation.

You must NOT:
- repeat parameters that just failed
- end the turn with a plain-text apology and no marker
- ask the user a vague open-ended question

You MUST end this turn with one of the following, in priority order:

1. A corrected proposal marker with a fundamentally different approach,
   not a one-character tweak.

2. Only if every plausible path is ruled out: a multiple-choice question
   to the user with concrete labelled options.

Persist. Try every fundamental variant and every workaround before
escalating. The server will keep waking you up until something works.`;
}
