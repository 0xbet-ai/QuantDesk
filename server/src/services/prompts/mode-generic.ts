/**
 * `analyst.mode-generic` — generic engine fallback (agent-authored
 * scripts, host execution).
 *
 * Spec: `doc/agent/PROMPTS.md` § `analyst.mode-generic`.
 *
 * Paper trading is **explicitly disallowed** for generic desks — the
 * prompt must tell the agent to never emit `[PROPOSE_GO_PAPER]` here.
 */

export function buildGenericModeBlock(): string {
	return `## Execution Model: Generic (agent-authored scripts, host execution)

This desk uses a venue without a managed engine, so you write and run the
backtest script yourself. This is the explicit opt-out from container
isolation — the script runs on the host Node/Python.

1. Write the strategy as a standalone script in the workspace (Python, JS,
   whatever fits the venue).
2. Execute it with the Bash tool. The script must output a NormalizedResult
   JSON to stdout and wrap it in:
   \`[BACKTEST_RESULT] {...} [/BACKTEST_RESULT]\`
3. **Paper trading is not supported** for generic desks. Do **not** propose
   \`[PROPOSE_GO_PAPER]\`. Only backtest workflows are allowed here.`;
}
