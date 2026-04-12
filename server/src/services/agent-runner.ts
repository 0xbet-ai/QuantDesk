import type { AgentAdapter } from "@quantdesk/adapters";
import type { StrategyMode } from "@quantdesk/shared";
import { buildAnalystPrompt, buildRiskManagerPrompt } from "./prompt-builder.js";
import type { AnalystTrailChunk, CodeDiffContext, PaperSessionContext } from "./prompts/types.js";

interface DeskContext {
	name: string;
	budget: string;
	targetReturn: string;
	stopLoss: string;
	strategyMode: StrategyMode;
	engine: string;
	venues: string[];
	description: string | null;
}

interface MetricEntry {
	key: string;
	label: string;
	value: number;
	format: string;
	tone?: string;
}

interface RunInput {
	desk: DeskContext;
	experiment: { number: number; title: string };
	runs: Array<{
		runNumber: number;
		isBaseline: boolean;
		result: { metrics: MetricEntry[] } | null;
	}>;
	comments: Array<{ author: string; content: string }>;
	memorySummaries: Array<{ level: string; content: string }>;
	paperSession?: PaperSessionContext | null;
	sessionId: string | undefined;
	agentRole: "analyst" | "risk_manager";
	runResult?: { metrics: MetricEntry[] };
	validationRunNumber?: number;
	/** Strategy code diff for the run under validation. RM only. */
	codeDiff?: CodeDiffContext | null;
	/** Analyst reasoning trail leading up to the validated run. RM only. */
	analystTrail?: AnalystTrailChunk[] | null;
	/** Phase 27b — optional MCP config path passed through to the adapter. */
	mcpConfigPath?: string;
	/** Per-turn CLI settings file carrying workspace-sandbox deny rules. */
	settingsPath?: string;
}

interface RunResult {
	sessionId: string;
	resultText: string;
	usage: { inputTokens: number; outputTokens: number; costUsd?: number };
	error?: string;
}

type SpawnFn = (args: string[], stdin: string) => Promise<string[]>;

/** Only non-ASCII language we currently auto-detect. Extend the regex
 *  (and the return value) if a user writes in another script. */
const KOREAN_REGEX = /[\uAC00-\uD7AF]/;

function detectLanguageHint(input: RunInput): string | undefined {
	// 1. Latest user message — the strongest signal.
	const lastUserComment = [...input.comments].reverse().find((c) => c.author === "user");
	if (lastUserComment && KOREAN_REGEX.test(lastUserComment.content)) return "Korean";
	// 2. Desk description — same fallback the analyst system prompt uses
	//    on turn #0 ("match the language of the desk's Mission / goal").
	if (input.desk.description && KOREAN_REGEX.test(input.desk.description)) return "Korean";
	// 3. Latest analyst message — if the thread has already been running
	//    in Korean, the RM should stay in lockstep.
	for (let i = input.comments.length - 1; i >= 0; i--) {
		const c = input.comments[i]!;
		if (c.author === "analyst" && KOREAN_REGEX.test(c.content)) return "Korean";
	}
	return undefined;
}

export class AgentRunner {
	constructor(
		private adapter: AgentAdapter,
		private spawn: SpawnFn,
	) {}

	async run(input: RunInput): Promise<RunResult> {
		// Resolve a language hint for the RM prompt. The RM's system prompt
		// is dense English (checklist, verdict tool, desk constraints), so
		// without an explicit hint the LLM gets pulled into English even
		// when the rest of the thread is in Korean. We walk a fallback
		// chain that matches what the analyst already uses:
		//   1. the latest user comment (strongest signal)
		//   2. the desk description — set at creation, reflects the
		//      operator's mission language and is the same fallback the
		//      analyst system prompt uses on the very first turn
		//   3. the latest analyst comment — keeps the RM in lockstep with
		//      whatever language the analyst has already been replying in
		// Currently only Korean is auto-detected (matches the existing
		// single-language regex); if a future user writes in another
		// non-ASCII language, extend the detector here rather than in the
		// prompt template.
		const userLanguageHint = detectLanguageHint(input);

		const prompt =
			input.agentRole === "risk_manager" &&
			input.runResult &&
			typeof input.validationRunNumber === "number"
				? buildRiskManagerPrompt({
						desk: input.desk,
						experiment: input.experiment,
						runNumber: input.validationRunNumber,
						runResult: input.runResult,
						runs: input.runs,
						comments: input.comments,
						memorySummaries: input.memorySummaries,
						codeDiff: input.codeDiff ?? null,
						analystTrail: input.analystTrail ?? null,
						userLanguageHint,
					})
				: buildAnalystPrompt({
						desk: input.desk,
						experiment: input.experiment,
						runs: input.runs,
						comments: input.comments,
						memorySummaries: input.memorySummaries,
						paperSession: input.paperSession,
						isResume: !!input.sessionId,
					});

		const args = this.adapter.buildSpawnArgs(
			prompt,
			input.sessionId,
			input.mcpConfigPath,
			input.settingsPath,
		);

		try {
			const outputLines = await this.spawn(args, prompt);
			const parsed = this.adapter.parseOutputStream(outputLines);

			return {
				sessionId: parsed.sessionId,
				resultText: parsed.resultText,
				usage: parsed.usage,
			};
		} catch (err) {
			return {
				sessionId: input.sessionId ?? "",
				resultText: "",
				usage: { inputTokens: 0, outputTokens: 0 },
				error: err instanceof Error ? err.message : "Unknown error",
			};
		}
	}
}
