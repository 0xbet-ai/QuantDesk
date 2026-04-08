import { db } from "@quantdesk/db";
import { agentSessions, comments, experiments, memorySummaries, runs } from "@quantdesk/db/schema";
import { eq } from "drizzle-orm";
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
 * Generate a memory summary for a completed experiment.
 * Template-based (no LLM) — summarizes best/latest runs and key user messages.
 * Phase 7 will upgrade this to LLM-generated summaries.
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

	const lines: string[] = [];
	lines.push(`Experiment #${experiment.number}: ${experiment.title}`);

	// Summarize runs — use the first metric as the "primary" for sorting (usually return-like)
	type Metric = { key: string; label: string; value: number; format: string };
	type RunResult = { metrics: Metric[] };

	const completedRuns = expRuns.filter((r) => {
		const result = r.result as RunResult | null;
		return result && Array.isArray(result.metrics) && result.metrics.length > 0;
	});
	if (completedRuns.length > 0) {
		const primary = (r: (typeof completedRuns)[number]): number => {
			const result = r.result as RunResult;
			return result.metrics[0]?.value ?? 0;
		};
		const best = completedRuns.reduce((a, b) => (primary(a) > primary(b) ? a : b));
		const bestResult = best.result as RunResult;
		const metricSummary = bestResult.metrics
			.slice(0, 4)
			.map((m) => `${m.label}=${m.value}`)
			.join(", ");
		lines.push(`Best run: #${best.runNumber} — ${metricSummary}`);
		lines.push(`Total runs: ${completedRuns.length}`);
	}

	// Include last analyst/risk_manager conclusion
	const lastAgentComment = [...expComments]
		.reverse()
		.find((c) => c.author === "analyst" || c.author === "risk_manager");
	if (lastAgentComment) {
		const snippet = lastAgentComment.content.slice(0, 300).replace(/\n+/g, " ");
		lines.push(`Final conclusion: ${snippet}`);
	}

	return lines.join("\n");
}

/**
 * Mark a single experiment as completed: persist memory summary, flip
 * status, and reset the desk's agent session so the next turn starts a
 * fresh CLI conversation. Used standalone by `PROPOSE_COMPLETE_EXPERIMENT`
 * (phase 06) and as the first half of `completeAndCreateNewExperiment`.
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
 * Used by both user-triggered (+ button) and agent-proposed (PROPOSE_NEW_EXPERIMENT) flows.
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
