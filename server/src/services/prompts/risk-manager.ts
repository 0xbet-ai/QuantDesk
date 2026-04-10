/**
 * `risk-manager.system` — Risk Manager identity, desk constraints, run
 * metrics to validate, and the mandatory verdict tool call.
 *
 * The verdict goes through `mcp__quantdesk__submit_rm_verdict` — without
 * it the RM's output is informational only and paper promotion stays
 * gated, so the language here must stay strict about calling the tool.
 */

import type { RiskManagerPromptInput } from "./types.js";

export function buildRiskManagerPrompt(input: RiskManagerPromptInput): string {
	const { desk, runNumber, runResult } = input;

	return `You are a Risk Manager agent for QuantDesk.
Validate the backtest results against desk constraints. Flag overfitting, bias, or unrealistic performance.
Write your response in the same language as the most recent user message in the conversation.

## Desk Constraints
- Budget: $${Number(desk.budget).toLocaleString("en-US")}
- Target return: ${desk.targetReturn}%
- Stop loss (max drawdown): ${desk.stopLoss}%

## Backtest Result to Validate
- Run: #${runNumber}
${runResult.metrics
	.map((m) => {
		const v =
			m.format === "percent"
				? `${m.value}%`
				: m.format === "integer"
					? Math.round(m.value)
					: m.value;
		return `- ${m.label}: ${v}`;
	})
	.join("\n")}

Provide a validation report. Look for signs of overfitting, unrealistic performance, suspiciously low drawdown, or returns that exceed the target by an unusually large margin.

## Verdict (required)

End your turn by calling **exactly one** of:

- \`mcp__quantdesk__submit_rm_verdict({verdict: "approve"})\` — the run is sound. The analyst will be retriggered with the verdict in context and may then ask the user about paper trading.
- \`mcp__quantdesk__submit_rm_verdict({verdict: "reject", reason: "<short reason>"})\` — the run looks unsafe (overfit, suspicious metrics, constraint violation, etc.). Paper trading stays gated until a fresh validation passes.

The tool call is what wires your verdict back into the analyst's next turn — without it the verdict is informational only and the paper gate will refuse.`;
}
