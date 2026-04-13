import { db } from "@quantdesk/db";
import {
	agentSessions,
	comments,
	experiments,
	memorySummaries,
	runLogs,
	runs,
} from "@quantdesk/db/schema";
import { eq, inArray } from "drizzle-orm";
import { stopAgent } from "./agent-trigger.js";
import { autoIncrementExperimentNumber } from "./logic.js";

interface CreateExperimentInput {
	deskId: string;
	title: string;
	description?: string;
}

export async function createExperiment(input: CreateExperimentInput) {
	const existing = await db.select().from(experiments).where(eq(experiments.deskId, input.deskId));

	const number = autoIncrementExperimentNumber(existing.length);

	const [experiment] = await db
		.insert(experiments)
		.values({
			deskId: input.deskId,
			number,
			title: input.title,
			description: input.description ?? null,
		})
		.returning();

	return experiment!;
}

export async function listExperiments(deskId: string) {
	return db
		.select()
		.from(experiments)
		.where(eq(experiments.deskId, deskId))
		.orderBy(experiments.number);
}

export async function getExperiment(id: string) {
	const [experiment] = await db.select().from(experiments).where(eq(experiments.id, id));
	return experiment ?? null;
}

/**
 * Generate a structured memory brief for a completed experiment.
 *
 * This is the core of the cross-experiment learning system (plan #22/23).
 * The brief is injected into the analyst prompt on every future turn, so
 * the agent never repeats a failed hypothesis or forgets a validated one.
 *
 * Template-based (no LLM call) — captures the experiment's key learnings
 * from structured data: runs, metrics, RM verdicts + rejection reasons,
 * and the analyst's final conclusion. Future upgrade path: replace with
 * an LLM-generated summary when API access is available (plan #23 phase 2).
 *
 * Design notes (hipocampus-inspired):
 *   - Keyword-dense format so BM25/grep can surface it even without vector search.
 *   - Captures WHY things failed/succeeded, not just WHAT the metrics were.
 *   - RM rejection reasons are the richest signal — they contain the specific
 *     overfitting tells and structural critiques the next experiment should avoid.
 *   - Capped at ~800 tokens per experiment to stay within the prompt's memory
 *     budget (enforced by prompt-builder's token trimmer, not here).
 */
async function generateMemorySummary(experimentId: string): Promise<string> {
	const [experiment] = await db.select().from(experiments).where(eq(experiments.id, experimentId));
	if (!experiment) return "";

	const expRuns = await db.select().from(runs).where(eq(runs.experimentId, experimentId));
	const expComments = await db
		.select()
		.from(comments)
		.where(eq(comments.experimentId, experimentId))
		.orderBy(comments.createdAt);

	type Metric = { key: string; label: string; value: number; format: string; tone?: string };
	type Validation = { verdict?: string; reason?: string };
	type RunResult = { metrics?: Metric[]; validation?: Validation };

	const lines: string[] = [];
	lines.push(`## Experiment #${experiment.number}: ${experiment.title}`);

	// ── Hypothesis ──────────────────────────────────────────────────
	// Extract the hypothesis from the first analyst comment (usually
	// contains the strategy plan). Take the first 200 chars.
	const firstAnalyst = expComments.find((c) => c.author === "analyst");
	if (firstAnalyst) {
		const snippet = firstAnalyst.content.slice(0, 200).replace(/\n+/g, " ").trim();
		lines.push(`Hypothesis: ${snippet}${firstAnalyst.content.length > 200 ? "..." : ""}`);
	}

	// ── Run progression ────────────────────────────────────────────
	const completedRuns = expRuns
		.filter((r) => {
			const result = r.result as RunResult | null;
			return (
				r.mode === "backtest" &&
				r.status === "completed" &&
				result &&
				Array.isArray(result.metrics) &&
				result.metrics.length > 0
			);
		})
		.sort((a, b) => a.runNumber - b.runNumber);

	if (completedRuns.length > 0) {
		lines.push(`Runs: ${completedRuns.length} completed backtests`);
		// Show each run's key metrics + RM verdict in one line
		for (const run of completedRuns) {
			const result = run.result as RunResult;
			const metrics = (result.metrics ?? []).slice(0, 4);
			const metricsStr = metrics
				.map((m) => {
					const v =
						m.format === "percent"
							? `${m.value}%`
							: m.format === "integer"
								? Math.round(m.value)
								: m.value;
					return `${m.label}=${v}`;
				})
				.join(", ");
			const verdict = result.validation?.verdict ?? "no review";
			const tag = run.isBaseline ? " (baseline)" : "";
			lines.push(`  Run #${run.runNumber}${tag}: ${metricsStr} → ${verdict}`);
		}

		// Best run summary
		const primary = (r: (typeof completedRuns)[number]): number => {
			const result = r.result as RunResult;
			return (result.metrics ?? [])[0]?.value ?? 0;
		};
		const best = completedRuns.reduce((a, b) => (primary(a) > primary(b) ? a : b));
		lines.push(`Best: Run #${best.runNumber} (${primary(best)}% return)`);
	} else {
		lines.push("Runs: no completed backtests (all failed or errored)");
	}

	// ── RM rejection reasons (the richest learning signal) ─────────
	// These contain specific structural critiques (overfitting tells,
	// drawdown violations, insufficient trades) that the next experiment
	// should avoid. Include the first 200 chars of each unique reason.
	const rejectionReasons: string[] = [];
	for (const run of completedRuns) {
		const result = run.result as RunResult;
		const v = result.validation;
		if (v?.verdict === "reject" && v.reason) {
			const short = v.reason.slice(0, 200).replace(/\n+/g, " ").trim();
			rejectionReasons.push(
				`  Run #${run.runNumber} rejected: ${short}${v.reason.length > 200 ? "..." : ""}`,
			);
		}
	}
	if (rejectionReasons.length > 0) {
		lines.push("RM rejections:");
		lines.push(...rejectionReasons);
	}

	// ── Paper trading outcome ──────────────────────────────────────
	const paperRuns = expRuns.filter((r) => r.mode === "paper");
	if (paperRuns.length > 0) {
		const lastPaper = paperRuns[paperRuns.length - 1]!;
		lines.push(`Paper trading: ${lastPaper.status} (promoted from Run #${lastPaper.runNumber})`);
	}

	// ── Outcome + final conclusion ─────────────────────────────────
	const outcome = paperRuns.length > 0 ? "promoted to paper" : "abandoned / pivoted";
	lines.push(`Outcome: ${outcome}`);

	// Last RM comment often has the best summary of what went wrong
	const lastRm = [...expComments].reverse().find((c) => c.author === "risk_manager");
	if (lastRm) {
		const snippet = lastRm.content.slice(0, 300).replace(/\n+/g, " ").trim();
		lines.push(`RM final assessment: ${snippet}${lastRm.content.length > 300 ? "..." : ""}`);
	}

	// Last analyst comment for the analyst's own takeaway
	const lastAnalyst = [...expComments].reverse().find((c) => c.author === "analyst");
	if (lastAnalyst && lastAnalyst !== firstAnalyst) {
		const snippet = lastAnalyst.content.slice(0, 200).replace(/\n+/g, " ").trim();
		lines.push(`Analyst conclusion: ${snippet}${lastAnalyst.content.length > 200 ? "..." : ""}`);
	}

	return lines.join("\n");
}

/**
 * Mark a single experiment as completed: persist memory summary, flip
 * status, and reset the desk's agent session so the next turn starts a
 * fresh CLI conversation. Used standalone by the `[COMPLETE_EXPERIMENT]`
 * marker path and as the first half of `completeAndCreateNewExperiment`.
 */
export async function completeExperiment(experimentId: string): Promise<void> {
	const current = await getExperiment(experimentId);
	if (!current) throw new Error("Experiment not found");

	// 1. Generate memory summary
	const summary = await generateMemorySummary(current.id);
	if (summary) {
		await db.insert(memorySummaries).values({
			deskId: current.deskId,
			experimentId: current.id,
			level: "experiment",
			content: summary,
		});
	}

	// 2. Mark current experiment as completed
	await db
		.update(experiments)
		.set({ status: "completed", updatedAt: new Date() })
		.where(eq(experiments.id, current.id));

	// 3. Reset agent session for this desk (new sessionId on next run)
	await db
		.update(agentSessions)
		.set({ sessionId: null, updatedAt: new Date() })
		.where(eq(agentSessions.deskId, current.deskId));
}

/**
 * Complete current experiment and create a new one.
 * Used by both user-triggered (+ button) and agent-driven (`[NEW_EXPERIMENT]`) flows.
 */
export async function completeAndCreateNewExperiment(input: {
	currentExperimentId: string;
	newTitle: string;
	newDescription?: string;
}) {
	const current = await getExperiment(input.currentExperimentId);
	if (!current) throw new Error("Current experiment not found");

	await completeExperiment(current.id);

	const newExperiment = await createExperiment({
		deskId: current.deskId,
		title: input.newTitle,
		description: input.newDescription,
	});

	return newExperiment;
}

/**
 * Delete an experiment and all its children (runs, run_logs, comments,
 * memory_summaries). Stops any running agent first. Refuses to delete the
 * last remaining experiment on a desk — every desk must keep at least one
 * experiment so the comment thread has a home.
 */
export async function deleteExperiment(experimentId: string): Promise<void> {
	const current = await getExperiment(experimentId);
	if (!current) throw new Error("Experiment not found");

	const siblings = await db
		.select({ id: experiments.id })
		.from(experiments)
		.where(eq(experiments.deskId, current.deskId));
	if (siblings.length <= 1) {
		throw new Error("Cannot delete the last experiment on a desk");
	}

	// Stop agent subprocess if it's running for this experiment.
	stopAgent(experimentId);

	// Delete run_logs for all runs in this experiment.
	const expRuns = await db
		.select({ id: runs.id })
		.from(runs)
		.where(eq(runs.experimentId, experimentId));
	if (expRuns.length > 0) {
		const runIds = expRuns.map((r) => r.id);
		await db.delete(runLogs).where(inArray(runLogs.runId, runIds));
		await db.delete(runs).where(eq(runs.experimentId, experimentId));
	}

	await db.delete(comments).where(eq(comments.experimentId, experimentId));
	await db.delete(memorySummaries).where(eq(memorySummaries.experimentId, experimentId));
	await db.delete(experiments).where(eq(experiments.id, experimentId));
}
