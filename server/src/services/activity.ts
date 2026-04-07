import { db } from "@quantdesk/db";
import { comments, experiments, runs } from "@quantdesk/db/schema";
import { desc, eq } from "drizzle-orm";

export interface ActivityItem {
	id: string;
	type:
		| "experiment_created"
		| "run_created"
		| "run_completed"
		| "run_failed"
		| "comment"
		| "go_paper"
		| "run_stopped";
	actor: string;
	summary: string;
	detail: string | null;
	timestamp: string;
}

export async function listActivity(deskId: string, limit = 50): Promise<ActivityItem[]> {
	const items: ActivityItem[] = [];

	const exps = await db
		.select()
		.from(experiments)
		.where(eq(experiments.deskId, deskId))
		.orderBy(desc(experiments.createdAt));

	const expIds = exps.map((e) => e.id);
	const expMap = new Map(exps.map((e) => [e.id, e]));

	if (expIds.length === 0) return [];

	// Fetch runs and comments for all experiments in this desk
	const allRuns: (typeof runs.$inferSelect)[] = [];
	const allComments: (typeof comments.$inferSelect)[] = [];

	for (const expId of expIds) {
		const expRuns = await db.select().from(runs).where(eq(runs.experimentId, expId));
		allRuns.push(...expRuns);

		const expComments = await db.select().from(comments).where(eq(comments.experimentId, expId));
		allComments.push(...expComments);
	}

	// Experiment created events
	for (const exp of exps) {
		items.push({
			id: `exp-${exp.id}`,
			type: "experiment_created",
			actor: "System",
			summary: `Experiment #${exp.number} created`,
			detail: exp.title,
			timestamp: exp.createdAt.toISOString(),
		});
	}

	// Run events
	for (const run of allRuns) {
		const exp = expMap.get(run.experimentId);
		const expLabel = exp ? `#${exp.number} ${exp.title}` : "";

		items.push({
			id: `run-create-${run.id}`,
			type: run.mode === "paper" ? "go_paper" : "run_created",
			actor: "System",
			summary:
				run.mode === "paper"
					? `Run #${run.runNumber} started paper trading`
					: `Run #${run.runNumber} started`,
			detail: expLabel,
			timestamp: run.createdAt.toISOString(),
		});

		if (run.completedAt) {
			const type =
				run.status === "failed"
					? "run_failed"
					: run.status === "stopped"
						? "run_stopped"
						: "run_completed";
			items.push({
				id: `run-end-${run.id}`,
				type,
				actor: "System",
				summary: `Run #${run.runNumber} ${run.status}`,
				detail: expLabel,
				timestamp: run.completedAt.toISOString(),
			});
		}
	}

	// Comment events
	for (const comment of allComments) {
		const exp = expMap.get(comment.experimentId);
		const expLabel = exp ? `#${exp.number} ${exp.title}` : "";

		items.push({
			id: `comment-${comment.id}`,
			type: "comment",
			actor: comment.author === "user" ? "You" : comment.author,
			summary: `${comment.author === "user" ? "You" : comment.author} commented`,
			detail: expLabel,
			timestamp: comment.createdAt.toISOString(),
		});
	}

	// Sort by timestamp descending
	items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

	return items.slice(0, limit);
}
