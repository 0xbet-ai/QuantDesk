import { existsSync, mkdirSync, readdirSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { db } from "@quantdesk/db";
import { datasets, deskDatasets, desks, experiments } from "@quantdesk/db/schema";
import { getAdapter as getEngineAdapter } from "@quantdesk/engines";
import type { DataFetchRequest as DataFetchProposal } from "@quantdesk/shared";
import { and, eq, sql } from "drizzle-orm";
import { publishExperimentEvent } from "../realtime/live-events.js";
import { systemComment } from "./comments.js";

/**
 * Server-side data fetch orchestration.
 *
 * This file is intentionally engine-agnostic. The actual download is
 * delegated to the desk's `EngineAdapter.downloadData` — this service
 * only owns the QuantDesk-level concerns:
 *
 *   - global dataset cache root (`~/.quantdesk/datacache`) so multiple
 *     desks can share a single download of the same window
 *   - `datasets` / `desk_datasets` DB dedupe and linkage
 *   - workspace symlink (`<workspace>/data/<exchange> → cache`) so
 *     strategy code sees a workspace-local path
 *   - user-facing system comments (progress / success / failure)
 *   - mock-mode synthetic dataset for UI tests
 *
 * Engine-specific knowledge (docker image, CLI flags, user_data layout,
 * trade-mode handling) lives inside each adapter's `downloadData`.
 */

const DATA_CACHE_ROOT =
	process.env.QUANTDESK_DATA_CACHE ?? join(homedir(), ".quantdesk", "datacache");

interface ExecuteArgs {
	experimentId: string;
	proposal: DataFetchProposal;
	parentCommentId?: string;
}

export async function executeDataFetch({ experimentId, proposal, parentCommentId }: ExecuteArgs) {
	const threadMeta = parentCommentId ? { parentCommentId } : undefined;
	const [experiment] = await db
		.select()
		.from(experiments)
		.where(eq(experiments.id, experimentId));
	if (!experiment) throw new Error(`Experiment ${experimentId} not found`);

	const [desk] = await db.select().from(desks).where(eq(desks.id, experiment.deskId));
	if (!desk) throw new Error(`Desk ${experiment.deskId} not found`);

	if (!desk.workspacePath) {
		throw new Error(`Desk ${desk.id} has no workspace path`);
	}

	// Compute the window. Proposal carries `days`; the adapter wants
	// absolute start/end dates.
	const end = new Date();
	const start = new Date(end.getTime() - proposal.days * 24 * 60 * 60 * 1000);
	const startDate = start.toISOString().slice(0, 10);
	const endDate = end.toISOString().slice(0, 10);
	const sortedPairs = [...proposal.pairs].sort();

	// 1. Dedupe: identical row already cached globally → just link it.
	const existing = await db
		.select()
		.from(datasets)
		.where(
			and(
				eq(datasets.exchange, proposal.exchange),
				eq(datasets.timeframe, proposal.timeframe),
				sql`${datasets.pairs}::jsonb = ${JSON.stringify(sortedPairs)}::jsonb`,
				sql`${datasets.dateRange}->>'start' = ${startDate}`,
				sql`${datasets.dateRange}->>'end' = ${endDate}`,
			),
		);

	const exchangeCachePath = join(DATA_CACHE_ROOT, proposal.exchange);
	const workspaceAbs = resolve(desk.workspacePath);
	const workspaceDataLink = join(workspaceAbs, "data", proposal.exchange);

	if (existing.length > 0) {
		const dataset = existing[0]!;
		await linkDatasetToDesk(desk.id, dataset.id);
		ensureSymlink(exchangeCachePath, workspaceDataLink);
		await systemComment({
			experimentId,
			nextAction: "action",
			content:
				`Reusing existing dataset for ${proposal.pairs.join(", ")} ${proposal.timeframe} ` +
				`from ${proposal.exchange} (${startDate} → ${endDate}). No download needed. ` +
				"You may now write the strategy and call mcp__quantdesk__run_backtest.",
			metadata: threadMeta,
		});
		return dataset;
	}

	// 2. Prepare the shared cache root.
	mkdirSync(DATA_CACHE_ROOT, { recursive: true });
	mkdirSync(exchangeCachePath, { recursive: true });

	// 3. Delegate the actual download to the engine adapter.
	await systemComment({
		experimentId,
		nextAction: "progress",
		content:
			`Downloading ${proposal.pairs.join(", ")} ${proposal.timeframe} from ${proposal.exchange} ` +
			`(${proposal.days}d, ${startDate} → ${endDate}) into shared data cache...`,
		metadata: threadMeta,
	});

	const adapter = getEngineAdapter(desk.engine);
	try {
		await adapter.downloadData({
			exchange: proposal.exchange,
			pairs: proposal.pairs,
			timeframe: proposal.timeframe,
			startDate,
			endDate,
			workspacePath: workspaceAbs,
			userDir: DATA_CACHE_ROOT,
			tradingMode: proposal.tradingMode,
			onLogLine: (line) => {
				publishExperimentEvent({
					experimentId,
					type: "data_fetch.progress",
					payload: { line },
				});
			},
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const tail = message.split("\n").slice(-8).join("\n");
		await systemComment({
			experimentId,
			nextAction: "action",
			content:
				`Data-fetch failed for ${proposal.pairs.join(", ")} on ${proposal.exchange}. ` +
				"Check the pair naming and trade mode, then ask the user about a corrected fetch and call mcp__quantdesk__data_fetch again once they agree. " +
				`Last log lines:\n\`\`\`log\n${tail || "(no output)"}\n\`\`\``,
			metadata: threadMeta,
		});
		return null;
	}

	// 4. Verify the adapter actually wrote files. If not, treat as failure.
	const files =
		existsSync(exchangeCachePath) &&
		readdirSync(exchangeCachePath).filter((f) => !f.startsWith("."));
	const fileCount = files ? files.length : 0;
	if (fileCount === 0) {
		await systemComment({
			experimentId,
			nextAction: "action",
			content:
				`Data-fetch for ${proposal.pairs.join(", ")} on ${proposal.exchange} produced no files. ` +
				"Adjust the pair naming or trade mode and call mcp__quantdesk__data_fetch again once the user agrees.",
			metadata: threadMeta,
		});
		return null;
	}

	// 5. Insert the global dataset row + link to this desk + symlink into the workspace.
	const [dataset] = await db
		.insert(datasets)
		.values({
			exchange: proposal.exchange,
			pairs: sortedPairs,
			timeframe: proposal.timeframe,
			dateRange: { start: startDate, end: endDate },
			path: exchangeCachePath,
		})
		.returning();
	if (dataset) {
		await linkDatasetToDesk(desk.id, dataset.id);
		ensureSymlink(exchangeCachePath, workspaceDataLink);
	}

	await systemComment({
		experimentId,
		nextAction: "action",
		content:
			`Downloaded ${fileCount} file(s) for ${proposal.pairs.join(", ")} ` +
			`${proposal.timeframe} from ${proposal.exchange} into shared cache. Dataset registered ` +
			"and linked to this desk. You may now write the strategy and call mcp__quantdesk__run_backtest.",
		metadata: threadMeta,
	});
	return dataset ?? null;
}

async function linkDatasetToDesk(deskId: string, datasetId: string) {
	const existingLink = await db
		.select()
		.from(deskDatasets)
		.where(and(eq(deskDatasets.deskId, deskId), eq(deskDatasets.datasetId, datasetId)));
	if (existingLink.length === 0) {
		await db.insert(deskDatasets).values({ deskId, datasetId });
	}
}

function ensureSymlink(target: string, linkPath: string) {
	try {
		mkdirSync(join(linkPath, ".."), { recursive: true });
		try {
			unlinkSync(linkPath);
		} catch {
			/* link didn't exist */
		}
		symlinkSync(target, linkPath, "dir");
	} catch (err) {
		console.error(`Failed to create symlink ${linkPath} → ${target}:`, err);
	}
}

