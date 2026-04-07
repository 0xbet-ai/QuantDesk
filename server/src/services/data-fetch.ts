import { existsSync, mkdirSync, readdirSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { db } from "@quantdesk/db";
import { datasets, deskDatasets, desks, experiments } from "@quantdesk/db/schema";
import { ENGINE_IMAGES, runContainer } from "@quantdesk/engines";
import { and, eq, sql } from "drizzle-orm";
import { createComment } from "./comments.js";
import type { DataFetchProposal } from "./triggers.js";

const DATA_CACHE_ROOT =
	process.env.QUANTDESK_DATA_CACHE ?? join(homedir(), ".quantdesk", "datacache");

interface ExecuteArgs {
	experimentId: string;
	proposal: DataFetchProposal;
}

/**
 * Execute an approved data-fetch proposal.
 *
 * Datasets are stored in a single global cache at
 *   `~/.quantdesk/datacache/<exchange>/...`
 * and linked into each desk's workspace via a symlink at
 *   `<workspace>/data/<exchange>`
 * so the agent sees a workspace-local path but storage is shared across
 * every desk that has approved the same (exchange, pairs, timeframe,
 * date-range) dataset. The global `datasets` table holds one row per
 * dataset identity; the `desk_datasets` join table records which desks
 * have linked which datasets.
 */
export async function executeDataFetch({ experimentId, proposal }: ExecuteArgs) {
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

	if (desk.strategyMode !== "classic") {
		// realtime / generic: no server-side fetcher — the agent handles it.
		await createComment({
			experimentId,
			author: "system",
			content:
				`Data-fetch proposal approved, but strategy_mode=${desk.strategyMode} does not have a ` +
				"server-side fetcher yet. Proceed to fetch the data yourself from within your " +
				"strategy workspace.",
		});
		return null;
	}

	// Classic: freqtrade download-data into the shared cache, then symlink
	// into the desk workspace.
	const end = new Date();
	const start = new Date(end.getTime() - proposal.days * 24 * 60 * 60 * 1000);
	const fmt = (d: Date) =>
		`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
	const timerange = `${fmt(start)}-${fmt(end)}`;
	const startDate = start.toISOString().slice(0, 10);
	const endDate = end.toISOString().slice(0, 10);

	// 1. Check if an identical dataset row already exists globally. If so,
	//    we can skip the download entirely and just link it to this desk.
	const sortedPairs = [...proposal.pairs].sort();
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
		await createComment({
			experimentId,
			author: "system",
			content:
				`Reusing existing dataset for ${proposal.pairs.join(", ")} ${proposal.timeframe} ` +
				`from ${proposal.exchange} (${startDate} → ${endDate}). No download needed. ` +
				"You may now write the strategy and emit [RUN_BACKTEST].",
		});
		return dataset;
	}

	// 2. No match — download into the shared cache.
	mkdirSync(DATA_CACHE_ROOT, { recursive: true });
	mkdirSync(exchangeCachePath, { recursive: true });
	// freqtrade wants a user_data-shaped directory. We give it a temp
	// workspace rooted at DATA_CACHE_ROOT with the target `data/<exchange>`
	// being the real cache path — freqtrade writes there directly.
	const cacheUserDir = DATA_CACHE_ROOT;
	mkdirSync(join(cacheUserDir, "data"), { recursive: true });

	await createComment({
		experimentId,
		author: "system",
		content:
			`Downloading ${proposal.pairs.join(", ")} ${proposal.timeframe} from ${proposal.exchange} ` +
			`(${proposal.days}d, ${timerange}) into shared data cache...`,
	});

	const cmd = [
		"download-data",
		"--userdir",
		"/datacache",
		"--exchange",
		proposal.exchange,
		"--pairs",
		...proposal.pairs,
		"--timeframes",
		proposal.timeframe,
		"--timerange",
		timerange,
	];
	if (proposal.tradingMode && proposal.tradingMode !== "spot") {
		cmd.push("--trading-mode", proposal.tradingMode);
	}

	const result = await runContainer({
		image: ENGINE_IMAGES.freqtrade,
		rm: true,
		volumes: [`${cacheUserDir}:/datacache`],
		command: cmd,
	});

	const files =
		existsSync(exchangeCachePath) &&
		readdirSync(exchangeCachePath).filter((f) => !f.startsWith("."));
	const fileCount = files ? files.length : 0;

	if (result.exitCode !== 0 || fileCount === 0) {
		const tail = (result.stderr || result.stdout || "")
			.trimEnd()
			.split("\n")
			.slice(-8)
			.join("\n");
		await createComment({
			experimentId,
			author: "system",
			content:
				`Data-fetch failed for ${proposal.pairs.join(", ")} on ${proposal.exchange}. ` +
				"Check the pair naming and trade mode, then emit a corrected [PROPOSE_DATA_FETCH]. " +
				`Last log lines:\n\`\`\`\n${tail || "(no output)"}\n\`\`\``,
		});
		return null;
	}

	// 3. Insert global dataset row + link to this desk + symlink into the
	//    workspace so strategy.py sees the standard `data/<exchange>/` path.
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

	await createComment({
		experimentId,
		author: "system",
		content:
			`Downloaded ${fileCount} file(s) for ${proposal.pairs.join(", ")} ` +
			`${proposal.timeframe} from ${proposal.exchange} into shared cache. Dataset registered ` +
			"and linked to this desk. You may now write the strategy and emit [RUN_BACKTEST].",
	});

	return dataset ?? null;
}

async function linkDatasetToDesk(deskId: string, datasetId: string) {
	const existing = await db
		.select()
		.from(deskDatasets)
		.where(and(eq(deskDatasets.deskId, deskId), eq(deskDatasets.datasetId, datasetId)));
	if (existing.length === 0) {
		await db.insert(deskDatasets).values({ deskId, datasetId });
	}
}

/**
 * Ensure `linkPath` is a symlink pointing at `target`. If something is
 * already there (file, dir, or a stale link), replace it.
 */
function ensureSymlink(target: string, linkPath: string) {
	const parent = linkPath.substring(0, linkPath.lastIndexOf("/"));
	mkdirSync(parent, { recursive: true });
	try {
		unlinkSync(linkPath);
	} catch {
		/* nothing to remove */
	}
	symlinkSync(target, linkPath);
}
