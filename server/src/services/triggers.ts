import type { ProposalType } from "./proposal-handlers/registry.js";

export interface Proposal {
	type:
		| "PROPOSE_VALIDATION"
		| "PROPOSE_NEW_EXPERIMENT"
		| "PROPOSE_COMPLETE_EXPERIMENT"
		| "PROPOSE_GO_PAPER";
	value: string;
}

/**
 * Map a `[PROPOSE_*]` marker name to the lowercase `ProposalType` enum the
 * approve router uses. Keep this in sync with `proposal-handlers/registry.ts`.
 */
export function markerToProposalType(marker: Proposal["type"]): ProposalType {
	switch (marker) {
		case "PROPOSE_VALIDATION":
			return "validation";
		case "PROPOSE_NEW_EXPERIMENT":
			return "new_experiment";
		case "PROPOSE_COMPLETE_EXPERIMENT":
			return "complete_experiment";
		case "PROPOSE_GO_PAPER":
			return "go_paper";
	}
}

const MARKER_PATTERN =
	/^\[(PROPOSE_VALIDATION|PROPOSE_NEW_EXPERIMENT|PROPOSE_COMPLETE_EXPERIMENT|PROPOSE_GO_PAPER)\](?:\s+(.*))?$/;

export function detectProposals(text: string): Proposal[] {
	const proposals: Proposal[] = [];

	for (const line of text.split("\n")) {
		const match = line.trim().match(MARKER_PATTERN);
		if (match) {
			proposals.push({
				type: match[1] as Proposal["type"],
				value: (match[2] ?? "").trim(),
			});
		}
	}

	return proposals;
}

/**
 * A data-fetch proposal: the agent asks the user to approve downloading
 * a specific historical dataset before any strategy code is written.
 * This is the mandatory first step for any brand-new desk (CLAUDE.md rule #13).
 */
export interface DataFetchProposal {
	exchange: string;
	pairs: string[];
	timeframe: string;
	days: number;
	tradingMode?: "spot" | "futures" | "margin";
	rationale?: string;
}

export function extractDataFetchProposal(text: string): DataFetchProposal | null {
	const match = text.match(/\[PROPOSE_DATA_FETCH\]\s*([\s\S]*?)\s*\[\/PROPOSE_DATA_FETCH\]/);
	if (!match?.[1]) return null;
	try {
		const parsed = JSON.parse(match[1]) as Partial<DataFetchProposal>;
		if (
			typeof parsed.exchange !== "string" ||
			!Array.isArray(parsed.pairs) ||
			typeof parsed.timeframe !== "string" ||
			typeof parsed.days !== "number"
		) {
			return null;
		}
		return {
			exchange: parsed.exchange,
			pairs: parsed.pairs,
			timeframe: parsed.timeframe,
			days: parsed.days,
			tradingMode: parsed.tradingMode,
			rationale: parsed.rationale,
		};
	} catch {
		return null;
	}
}
