/**
 * Single source of truth for agent output markers.
 *
 * The analyst agent emits tagged markers like `[RUN_BACKTEST]...[/RUN_BACKTEST]`
 * or single-line `[EXPERIMENT_TITLE] New title` to signal side-effects the
 * server must run. These markers must never leak to the user — both the server
 * (when persisting comments) and the UI (when rendering transcripts) strip
 * them. Keeping the list in one place prevents the two sites from drifting.
 *
 * Add a new marker here and both stripping and display handling pick it up.
 */

type MarkerKind = "block" | "line";
type MarkerDisplay = "strip" | "json-code-block";

interface MarkerDef {
	name: string;
	kind: MarkerKind;
	/** How the marker should be rendered in the transcript view. `strip`
	 *  removes it entirely; `json-code-block` reformats the body as fenced
	 *  JSON so the user sees the structured payload. */
	display: MarkerDisplay;
}

export const AGENT_MARKERS: readonly MarkerDef[] = [
	{ name: "BACKTEST_RESULT", kind: "block", display: "json-code-block" },
	{ name: "DATASET", kind: "block", display: "json-code-block" },
	{ name: "RUN_BACKTEST", kind: "block", display: "strip" },
	{ name: "PROPOSE_DATA_FETCH", kind: "block", display: "strip" },
	{ name: "EXPERIMENT_TITLE", kind: "line", display: "strip" },
	{ name: "RUN_PAPER", kind: "line", display: "strip" },
	{ name: "PROPOSE_VALIDATION", kind: "line", display: "strip" },
	{ name: "PROPOSE_NEW_EXPERIMENT", kind: "line", display: "strip" },
	{ name: "PROPOSE_COMPLETE_EXPERIMENT", kind: "line", display: "strip" },
	{ name: "PROPOSE_GO_PAPER", kind: "line", display: "strip" },
	// Risk Manager verdict markers (phase 08)
	{ name: "RM_APPROVE", kind: "line", display: "strip" },
	{ name: "RM_REJECT", kind: "line", display: "strip" },
];

function blockRegex(name: string): RegExp {
	return new RegExp(`\\[${name}\\]\\s*([\\s\\S]*?)\\s*\\[\\/${name}\\]`, "g");
}

function lineRegex(name: string): RegExp {
	return new RegExp(`^\\[${name}\\].*$`, "gm");
}

// ──────────────────────────────────────────────────────────────────────────
// Marker extractors
//
// One canonical home for every "find a marker in text" function. Adding a
// new marker means: append to AGENT_MARKERS above, then add an extractor
// here. Server services and UI components must NOT inline their own marker
// regexes (caught by the SRP audit and the rule #14 phase lifecycle).
// ──────────────────────────────────────────────────────────────────────────

/**
 * Extract the body of a single block marker (e.g. `[FOO]...[/FOO]`).
 * Returns the trimmed body of the FIRST occurrence, or null if absent.
 */
function extractFirstBlockBody(text: string, name: string): string | null {
	const re = new RegExp(`\\[${name}\\]\\s*([\\s\\S]*?)\\s*\\[\\/${name}\\]`);
	const m = text.match(re);
	return m?.[1] ?? null;
}

/**
 * `[RUN_BACKTEST]\n{...json...}\n[/RUN_BACKTEST]` — strategy + config
 * payload the agent emits to request a server-run backtest.
 */
export interface RunBacktestRequest {
	strategyName?: string;
	configFile?: string;
	entrypoint?: string;
}
export function extractRunBacktestRequest(text: string): RunBacktestRequest | null {
	const body = extractFirstBlockBody(text, "RUN_BACKTEST");
	if (body === null) return null;
	if (!body.trim()) return {};
	try {
		return JSON.parse(body) as RunBacktestRequest;
	} catch {
		return {};
	}
}

/**
 * `[BACKTEST_RESULT]\n{...}\n[/BACKTEST_RESULT]` — normalized result block
 * the agent emits at the end of a successful run.
 */
export function extractBacktestResultBody(text: string): string | null {
	return extractFirstBlockBody(text, "BACKTEST_RESULT");
}

/**
 * `[DATASET]\n{...}\n[/DATASET]` — agent-side dataset registration block.
 */
export function extractDatasetBody(text: string): string | null {
	return extractFirstBlockBody(text, "DATASET");
}

/**
 * `[EXPERIMENT_TITLE] <short title>` — line marker. Returns the trimmed
 * title or null if absent.
 */
export function extractExperimentTitle(text: string): string | null {
	const m = text.match(/\[EXPERIMENT_TITLE\]\s*(.+?)(?:\n|$)/);
	return m?.[1]?.trim() || null;
}

/**
 * `[RM_APPROVE]` / `[RM_REJECT] <reason>` — Risk Manager verdict markers
 * (phase 08). Approve takes precedence if both somehow appear.
 */
export interface RmVerdict {
	verdict: "approve" | "reject";
	reason: string;
}
export function extractRmVerdict(text: string): RmVerdict | null {
	const approveMatch = text.match(/^\[RM_APPROVE\](.*)$/m);
	if (approveMatch) {
		return { verdict: "approve", reason: (approveMatch[1] ?? "").trim() };
	}
	const rejectMatch = text.match(/^\[RM_REJECT\](.*)$/m);
	if (rejectMatch) {
		return { verdict: "reject", reason: (rejectMatch[1] ?? "").trim() };
	}
	return null;
}

function collapseBlankLines(text: string): string {
	return text.replace(/\n{3,}/g, "\n\n").trim();
}

/** Strip every marker from `text`. Use when persisting comments so nothing
 *  leaks to the user. */
export function stripAgentMarkers(text: string): string {
	let out = text;
	for (const marker of AGENT_MARKERS) {
		const re = marker.kind === "block" ? blockRegex(marker.name) : lineRegex(marker.name);
		out = out.replace(re, "");
	}
	return collapseBlankLines(out);
}

/** Strip or reformat markers for display in the transcript view. Block
 *  markers flagged as `json-code-block` become fenced JSON so the user sees
 *  the payload; everything else is removed. */
export function formatAgentMarkersForDisplay(text: string): string {
	let out = text;
	for (const marker of AGENT_MARKERS) {
		if (marker.display === "json-code-block" && marker.kind === "block") {
			out = out.replace(blockRegex(marker.name), (_match, body: string) => {
				const trimmed = (body ?? "").trim();
				return `\n\`\`\`json\n${trimmed}\n\`\`\`\n`;
			});
			continue;
		}
		const re = marker.kind === "block" ? blockRegex(marker.name) : lineRegex(marker.name);
		out = out.replace(re, "");
	}
	return collapseBlankLines(out);
}
