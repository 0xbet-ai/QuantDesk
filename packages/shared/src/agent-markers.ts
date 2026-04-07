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
];

function blockRegex(name: string): RegExp {
	return new RegExp(`\\[${name}\\]\\s*([\\s\\S]*?)\\s*\\[\\/${name}\\]`, "g");
}

function lineRegex(name: string): RegExp {
	return new RegExp(`^\\[${name}\\].*$`, "gm");
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
