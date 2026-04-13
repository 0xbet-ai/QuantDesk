/**
 * Desk package export / import.
 *
 * Export bundles a desk's full state (settings, experiments, runs,
 * comments, datasets metadata, agent session, memory summaries) as a
 * single JSON object suitable for download and later re-import.
 *
 * Import creates a fresh desk from a previously exported package,
 * re-inserting all child rows with new UUIDs and re-linking foreign
 * keys. The workspace directory is NOT included — the import creates
 * a new empty workspace.
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { db } from "@quantdesk/db";
import {
	agentSessions,
	comments,
	datasets,
	deskDatasets,
	desks,
	experiments,
	memorySummaries,
	runs,
} from "@quantdesk/db/schema";
import { eq } from "drizzle-orm";
import { initWorkspace } from "./workspace.js";

const WORKSPACES_ROOT = process.env.WORKSPACES_ROOT ?? join(process.cwd(), "workspaces");

// ── Export ───────────────────────────────────────────────────────────

export interface DeskPackage {
	version: 1;
	exportedAt: string;
	desk: {
		name: string;
		budget: string;
		targetReturn: string;
		stopLoss: string;
		strategyId: string | null;
		venues: string[];
		strategyMode: string;
		engine: string;
		config: Record<string, unknown>;
		description: string | null;
	};
	agent: {
		adapterType: string;
		adapterConfig: Record<string, unknown>;
	};
	experiments: Array<{
		number: number;
		title: string;
		description: string | null;
		status: string;
		runs: Array<{
			runNumber: number;
			isBaseline: boolean;
			mode: string;
			status: string;
			config: Record<string, unknown> | null;
			result: Record<string, unknown> | null;
			commitHash: string | null;
			error: string | null;
		}>;
		comments: Array<{
			author: string;
			content: string;
			metadata: Record<string, unknown> | null;
			createdAt: string;
		}>;
	}>;
	datasets: Array<{
		exchange: string;
		pairs: string[];
		timeframe: string;
		tradingMode: string;
		dateRange: { start: string; end: string };
	}>;
	memorySummaries: Array<{
		level: string;
		content: string;
	}>;
}

export async function exportDesk(deskId: string): Promise<DeskPackage> {
	const [desk] = await db.select().from(desks).where(eq(desks.id, deskId));
	if (!desk) throw new Error("Desk not found");

	const [session] = await db.select().from(agentSessions).where(eq(agentSessions.deskId, deskId));

	const exps = await db
		.select()
		.from(experiments)
		.where(eq(experiments.deskId, deskId))
		.orderBy(experiments.number);

	const expData = await Promise.all(
		exps.map(async (exp) => {
			const expRuns = await db
				.select()
				.from(runs)
				.where(eq(runs.experimentId, exp.id))
				.orderBy(runs.runNumber);

			const expComments = await db
				.select()
				.from(comments)
				.where(eq(comments.experimentId, exp.id))
				.orderBy(comments.createdAt);

			return {
				number: exp.number,
				title: exp.title,
				description: exp.description,
				status: exp.status,
				runs: expRuns.map((r) => ({
					runNumber: r.runNumber,
					isBaseline: r.isBaseline,
					mode: r.mode,
					status: r.status,
					config: r.config ?? null,
					result: r.result ?? null,
					commitHash: r.commitHash,
					error: r.error,
				})),
				comments: expComments.map((c) => ({
					author: c.author,
					content: c.content,
					metadata: c.metadata ?? null,
					createdAt: c.createdAt.toISOString(),
				})),
			};
		}),
	);

	// Datasets linked to this desk
	const linkedDatasets = await db
		.select({ d: datasets })
		.from(deskDatasets)
		.innerJoin(datasets, eq(deskDatasets.datasetId, datasets.id))
		.where(eq(deskDatasets.deskId, deskId));

	const memories = await db
		.select()
		.from(memorySummaries)
		.where(eq(memorySummaries.deskId, deskId));

	return {
		version: 1,
		exportedAt: new Date().toISOString(),
		desk: {
			name: desk.name,
			budget: desk.budget,
			targetReturn: desk.targetReturn,
			stopLoss: desk.stopLoss,
			strategyId: desk.strategyId,
			venues: desk.venues,
			strategyMode: desk.strategyMode,
			engine: desk.engine,
			config: desk.config,
			description: desk.description,
		},
		agent: {
			adapterType: session?.adapterType ?? "claude",
			adapterConfig: session?.adapterConfig ?? {},
		},
		experiments: expData,
		datasets: linkedDatasets.map((row) => ({
			exchange: row.d.exchange,
			pairs: row.d.pairs,
			timeframe: row.d.timeframe,
			tradingMode: row.d.tradingMode,
			dateRange: row.d.dateRange,
		})),
		memorySummaries: memories.map((m) => ({
			level: m.level,
			content: m.content,
		})),
	};
}

// ── Import ──────────────────────────────────────────────────────────

export async function importDesk(
	pkg: DeskPackage,
): Promise<{ deskId: string; experimentCount: number }> {
	if (pkg.version !== 1) throw new Error(`Unsupported package version: ${pkg.version}`);

	const deskId = randomUUID();
	const now = new Date();

	// 1. Create desk
	await db.insert(desks).values({
		id: deskId,
		name: `${pkg.desk.name} (imported)`,
		budget: pkg.desk.budget,
		targetReturn: pkg.desk.targetReturn,
		stopLoss: pkg.desk.stopLoss,
		strategyId: pkg.desk.strategyId,
		venues: pkg.desk.venues,
		strategyMode: pkg.desk.strategyMode,
		engine: pkg.desk.engine,
		config: pkg.desk.config,
		description: pkg.desk.description,
		status: "active",
		createdAt: now,
		updatedAt: now,
	});

	// 2. Init workspace and update desk with path
	const workspacePath = await initWorkspace(deskId, pkg.desk.engine, WORKSPACES_ROOT);
	await db.update(desks).set({ workspacePath, updatedAt: now }).where(eq(desks.id, deskId));

	// 3. Create agent session
	await db.insert(agentSessions).values({
		deskId,
		agentRole: "analyst",
		adapterType: pkg.agent.adapterType,
		adapterConfig: pkg.agent.adapterConfig,
	});

	// 4. Re-create experiments, runs, comments
	for (const exp of pkg.experiments) {
		const expId = randomUUID();
		await db.insert(experiments).values({
			id: expId,
			deskId,
			number: exp.number,
			title: exp.title,
			description: exp.description,
			status: exp.status,
			createdAt: now,
			updatedAt: now,
		});

		for (const run of exp.runs) {
			await db.insert(runs).values({
				id: randomUUID(),
				experimentId: expId,
				runNumber: run.runNumber,
				isBaseline: run.isBaseline,
				mode: run.mode,
				status: run.status,
				config: run.config ?? {},
				result: run.result,
				commitHash: run.commitHash,
				error: run.error,
				createdAt: now,
			});
		}

		for (const comment of exp.comments) {
			await db.insert(comments).values({
				id: randomUUID(),
				experimentId: expId,
				author: comment.author,
				content: comment.content,
				metadata: comment.metadata,
				createdAt: new Date(comment.createdAt),
			});
		}
	}

	// 5. Re-create memory summaries
	for (const mem of pkg.memorySummaries) {
		await db.insert(memorySummaries).values({
			deskId,
			level: mem.level,
			content: mem.content,
			createdAt: now,
			updatedAt: now,
		});
	}

	return { deskId, experimentCount: pkg.experiments.length };
}
