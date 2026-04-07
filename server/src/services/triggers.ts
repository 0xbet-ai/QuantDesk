export interface Proposal {
	type:
		| "PROPOSE_VALIDATION"
		| "PROPOSE_NEW_EXPERIMENT"
		| "PROPOSE_COMPLETE_EXPERIMENT"
		| "PROPOSE_GO_PAPER";
	value: string;
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
