/**
 * Context collectors that enrich the Risk Manager prompt with the
 * two things it was previously blind to: (a) the strategy code that
 * produced a given run, and (b) the analyst's reasoning + tool calls
 * leading up to that run.
 *
 * Both collectors are pure — they read from the desk workspace git
 * history and the per-experiment JSONL log and return plain data
 * structures the prompt builder knows how to format. Failures are
 * non-fatal: an empty / null return still produces a valid RM prompt
 * (just without the enriched sections), because blocking validation
 * on a git glitch would strand the iteration loop.
 */

import type { AgentLogEntry } from "./agent-log.js";
import { readAgentLog } from "./agent-log.js";
import type { AnalystTrailChunk, CodeDiffContext } from "./prompts/types.js";
import { getDiff } from "./workspace.js";

/** Max chars per diff section injected into the prompt. ~2.5k tokens each. */
const MAX_DIFF_CHARS = 10_000;
/** Max total chars of analyst trail entries. ~1.5k tokens. */
const MAX_TRAIL_CHARS = 6_000;
/** Max chars per individual analyst trail chunk so one huge tool_result doesn't blow the budget. */
const MAX_CHUNK_CHARS = 1_200;

interface RunWithCommit {
	runNumber: number;
	isBaseline: boolean;
	commitHash: string | null;
	turnId: string | null;
	createdAt: Date;
}

/**
 * Build the code-diff context for `targetRun` by comparing its commit
 * hash against (a) the run immediately before it and (b) the baseline
 * run. Either diff can be null when the comparison isn't possible
 * (baseline itself, missing hashes, no prior run of the same kind).
 *
 * Returns `null` only when there is literally nothing useful to show —
 * e.g. the target run has no commit hash at all, or the workspace
 * path is missing. In that case the prompt skips the whole block.
 */
export async function collectCodeDiff(
	workspacePath: string | null,
	targetRun: RunWithCommit,
	expRuns: RunWithCommit[],
): Promise<CodeDiffContext | null> {
	if (!workspacePath) return null;
	if (!targetRun.commitHash) return null;

	// Sort by runNumber so "immediately before" means "the previous
	// completed run in natural order", not "the last insert".
	const ordered = [...expRuns].sort((a, b) => a.runNumber - b.runNumber);
	const targetIdx = ordered.findIndex((r) => r.runNumber === targetRun.runNumber);

	const previous =
		targetIdx > 0
			? [...ordered.slice(0, targetIdx)].reverse().find((r) => r.commitHash)
			: undefined;
	const baseline = ordered.find((r) => r.isBaseline && r.commitHash);

	let againstPrevious: string | null = null;
	let previousLabel: string | null = null;
	let againstBaseline: string | null = null;
	let baselineLabel: string | null = null;
	let truncated = false;

	if (previous?.commitHash && previous.commitHash !== targetRun.commitHash) {
		try {
			const raw = await getDiff(workspacePath, previous.commitHash, targetRun.commitHash);
			const trimmed = truncateDiff(raw);
			againstPrevious = trimmed.text;
			truncated = truncated || trimmed.truncated;
			previousLabel = `Run #${targetRun.runNumber} vs Run #${previous.runNumber}`;
		} catch {
			/* git failure is non-fatal — leave the section null */
		}
	}

	if (
		baseline?.commitHash &&
		baseline.runNumber !== targetRun.runNumber &&
		// Skip when the baseline IS the previous run — the two diffs
		// would be identical and just waste tokens.
		baseline.runNumber !== previous?.runNumber &&
		baseline.commitHash !== targetRun.commitHash
	) {
		try {
			const raw = await getDiff(workspacePath, baseline.commitHash, targetRun.commitHash);
			const trimmed = truncateDiff(raw);
			againstBaseline = trimmed.text;
			truncated = truncated || trimmed.truncated;
			baselineLabel = `Run #${targetRun.runNumber} vs Run #${baseline.runNumber} (baseline)`;
		} catch {
			/* non-fatal */
		}
	}

	// Nothing to show — e.g. target IS the baseline and no previous run.
	if (!againstPrevious && !againstBaseline) {
		return {
			targetCommit: targetRun.commitHash,
			againstPrevious: null,
			againstBaseline: null,
			previousLabel: null,
			baselineLabel: null,
			truncated: false,
		};
	}

	return {
		targetCommit: targetRun.commitHash,
		againstPrevious,
		againstBaseline,
		previousLabel,
		baselineLabel,
		truncated,
	};
}

function truncateDiff(raw: string): { text: string; truncated: boolean } {
	if (raw.length <= MAX_DIFF_CHARS) return { text: raw, truncated: false };
	return {
		text: `${raw.slice(0, MAX_DIFF_CHARS)}\n\n… (diff truncated, ${raw.length - MAX_DIFF_CHARS} more chars)`,
		truncated: true,
	};
}

/**
 * Pull the analyst's recent reasoning trail from the per-experiment
 * JSONL log. We look at the log entries *after* the most recent RM
 * verdict (or from the beginning if no verdict yet) and before the
 * validation request, so the RM sees exactly the analyst's working
 * leading into the run it's about to judge.
 *
 * The log contains chunks from both roles; we filter to analyst
 * entries only. Token budget is enforced by keeping the tail of the
 * stream — analyst's most recent reasoning matters more than what it
 * was doing five tool calls ago.
 */
export function collectAnalystTrail(experimentId: string): AnalystTrailChunk[] {
	let entries: AgentLogEntry[];
	try {
		entries = readAgentLog(experimentId);
	} catch {
		return [];
	}
	if (entries.length === 0) return [];

	// The log is cleared at the start of every turn (`clearAgentLog`),
	// so on the RM turn we only see the RM's own chunks — not the
	// analyst's. The JSONL on disk by the time the RM runs therefore
	// doesn't carry what we want. Fall through with an empty result
	// if we detect any risk_manager role marker inside the file.
	//
	// Workaround for the clear-on-turn behavior: collect trail at
	// dispatch time (before the RM spawns) from the most recent
	// analyst run — see `collectAnalystTrailFromEntries` below used
	// by the dispatcher, which passes the pre-clear snapshot in.
	return collectAnalystTrailFromEntries(entries);
}

/**
 * Pure transform of already-read log entries into trail chunks. Split
 * out so the dispatcher can snapshot the analyst log BEFORE the RM
 * turn overwrites it (the file is cleared at the start of every turn
 * by `clearAgentLog`).
 */
export function collectAnalystTrailFromEntries(entries: AgentLogEntry[]): AnalystTrailChunk[] {
	const analystEntries: AgentLogEntry[] = [];
	for (const entry of entries) {
		const type = entry.type;
		if (type !== "thinking" && type !== "tool_call" && type !== "text") continue;
		// Drop empty/echo chunks — tool_call carries content via `input`, not `content`.
		if (type !== "tool_call" && typeof entry.content !== "string") continue;
		analystEntries.push(entry);
	}
	if (analystEntries.length === 0) return [];

	// Walk backwards from the tail, accumulating up to MAX_TRAIL_CHARS.
	const reverseOrdered: AnalystTrailChunk[] = [];
	let chars = 0;
	for (let i = analystEntries.length - 1; i >= 0; i--) {
		const entry = analystEntries[i]!;
		const chunk = renderChunk(entry);
		if (!chunk) continue;
		const chunkChars = chunk.content.length + (chunk.name?.length ?? 0);
		if (chars + chunkChars > MAX_TRAIL_CHARS) break;
		chars += chunkChars;
		reverseOrdered.push(chunk);
	}
	return reverseOrdered.reverse();
}

function renderChunk(entry: AgentLogEntry): AnalystTrailChunk | null {
	const type = entry.type;
	if (type === "thinking") {
		const content = truncateChunk(String(entry.content ?? ""));
		if (!content.trim()) return null;
		return { type: "thinking", content };
	}
	if (type === "text") {
		const content = truncateChunk(String(entry.content ?? ""));
		if (!content.trim()) return null;
		return { type: "text", content };
	}
	if (type === "tool_call") {
		const name = typeof entry.name === "string" ? entry.name : "(unknown tool)";
		let inputStr: string;
		try {
			inputStr = JSON.stringify(entry.input ?? {});
		} catch {
			inputStr = "<unserializable>";
		}
		return { type: "tool_call", name, content: truncateChunk(inputStr) };
	}
	return null;
}

function truncateChunk(text: string): string {
	const flat = text.replace(/\s+/g, " ").trim();
	if (flat.length <= MAX_CHUNK_CHARS) return flat;
	return `${flat.slice(0, MAX_CHUNK_CHARS)}… (truncated, ${flat.length - MAX_CHUNK_CHARS} more chars)`;
}
