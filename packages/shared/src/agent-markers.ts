/**
 * Defensive marker stripping — phase 27d.
 *
 * The legacy bracketed-marker protocol has been retired in favour of MCP
 * tool calls (see `doc/agent/MCP.md`). The parsers and dispatch glue are
 * gone, but we still strip any leftover bracketed markers from agent
 * output defensively: an older resumed session might still echo them,
 * and there is no reason to show `[RUN_BACKTEST]{...}[/RUN_BACKTEST]`
 * garbage to the user.
 *
 * This file has two responsibilities and nothing else:
 *   - `stripAgentMarkers(text)` — remove every legacy marker so it
 *     doesn't leak into persisted comments.
 *   - `formatAgentMarkersForDisplay(text)` — UI-side alias (the UI
 *     renders the same sanitized text; JSON code-block formatting is
 *     no longer needed because structured payloads arrive via MCP).
 */

const LEGACY_MARKERS = [
	"BACKTEST_RESULT",
	"DATASET",
	"DATA_FETCH",
	"RUN_BACKTEST",
	"EXPERIMENT_TITLE",
	"VALIDATION",
	"NEW_EXPERIMENT",
	"COMPLETE_EXPERIMENT",
	"GO_PAPER",
	"RUN_PAPER",
	"RM_APPROVE",
	"RM_REJECT",
] as const;

function blockRegex(name: string): RegExp {
	return new RegExp(`\\[${name}\\]\\s*([\\s\\S]*?)\\s*\\[\\/${name}\\]`, "g");
}
function lineRegex(name: string): RegExp {
	return new RegExp(`^\\[${name}\\].*$`, "gm");
}

function collapseBlankLines(text: string): string {
	return text.replace(/\n{3,}/g, "\n\n").trim();
}

export function stripAgentMarkers(text: string): string {
	let out = text;
	for (const name of LEGACY_MARKERS) {
		out = out.replace(blockRegex(name), "");
		out = out.replace(lineRegex(name), "");
	}
	return collapseBlankLines(out);
}

export function formatAgentMarkersForDisplay(text: string): string {
	return stripAgentMarkers(text);
}
