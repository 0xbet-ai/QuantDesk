import {
	existsSync,
	mkdirSync,
	readdirSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { db } from "@quantdesk/db";
import { datasets, deskDatasets, desks, experiments } from "@quantdesk/db/schema";
import { ENGINE_IMAGES, runContainer } from "@quantdesk/engines";
import { and, eq, sql } from "drizzle-orm";
import { publishExperimentEvent } from "../realtime/live-events.js";
import { systemComment } from "./comments.js";
import type { DataFetchRequest as DataFetchProposal } from "@quantdesk/shared";

const DATA_CACHE_ROOT =
	process.env.QUANTDESK_DATA_CACHE ?? join(homedir(), ".quantdesk", "datacache");

interface ExecuteArgs {
	experimentId: string;
	proposal: DataFetchProposal;
	parentCommentId?: string;
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

	if (desk.strategyMode !== "classic") {
		// realtime / generic: no server-side fetcher — the agent handles it.
		await systemComment({
			experimentId,
			nextAction: "action",
			content:
				`Data-fetch proposal approved, but strategy_mode=${desk.strategyMode} does not have a ` +
				"server-side fetcher yet. Proceed to fetch the data yourself from within your " +
				"strategy workspace.",
			metadata: threadMeta,
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
		await systemComment({
			experimentId,
			nextAction: "action",
			content:
				`Reusing existing dataset for ${proposal.pairs.join(", ")} ${proposal.timeframe} ` +
				`from ${proposal.exchange} (${startDate} → ${endDate}). No download needed. ` +
				"You may now write the strategy and emit [RUN_BACKTEST].",
			metadata: threadMeta,
		});
		return dataset;
	}

	// 2. No match — download into the shared cache.
	mkdirSync(DATA_CACHE_ROOT, { recursive: true });
	mkdirSync(exchangeCachePath, { recursive: true });

	// Mock mode: skip the real freqtrade download and register a fake
	// dataset row so UI flows that depend on "data fetch approved" work
	// deterministically. Real binance has no data for the simulated
	// future date range (2026-04-08 system clock), so the normal path
	// would always fail with "length 0".
	if (process.env.MOCK_AGENT === "1") {
		// Write a tiny fake OHLCV file so the dataset preview endpoint
		// has something to read instead of choking on an empty dir.
		let firstFile: string | null = null;
		for (const pair of sortedPairs) {
			const safePair = pair.replace("/", "_");
			const file = join(exchangeCachePath, `${safePair}-${proposal.timeframe}.csv`);
			const rows: string[] = ["timestamp,open,high,low,close,volume"];
			const startMs = start.getTime();
			for (let i = 0; i < 50; i++) {
				const ts = startMs + i * 60 * 60 * 1000;
				const p = 60000 + Math.sin(i / 3) * 500;
				rows.push(
					`${ts},${p.toFixed(2)},${(p * 1.01).toFixed(2)},${(p * 0.99).toFixed(2)},${(p * 1.002).toFixed(2)},${(100 + i * 3).toFixed(2)}`,
				);
			}
			writeFileSync(file, rows.join("\n"));
			if (!firstFile) firstFile = file;
		}

		const [dataset] = await db
			.insert(datasets)
			.values({
				exchange: proposal.exchange,
				pairs: sortedPairs,
				timeframe: proposal.timeframe,
				dateRange: { start: startDate, end: endDate },
				// Point at a concrete CSV file (not the directory) so the
				// preview endpoint can readFile it without hitting EISDIR.
				path: firstFile ?? exchangeCachePath,
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
				`(mock) Downloaded ${proposal.pairs.join(", ")} ${proposal.timeframe} from ` +
				`${proposal.exchange} into shared cache. Dataset registered and linked to this ` +
				"desk. You may now write the strategy and emit [RUN_BACKTEST].",
			metadata: threadMeta,
		});
		return dataset ?? null;
	}
	// freqtrade wants a user_data-shaped directory. We give it a temp
	// workspace rooted at DATA_CACHE_ROOT with the target `data/<exchange>`
	// being the real cache path — freqtrade writes there directly.
	const cacheUserDir = DATA_CACHE_ROOT;
	mkdirSync(join(cacheUserDir, "data"), { recursive: true });

	await systemComment({
		experimentId,
		nextAction: "progress",
		content:
			`Downloading ${proposal.pairs.join(", ")} ${proposal.timeframe} from ${proposal.exchange} ` +
			`(${proposal.days}d, ${timerange}) into shared data cache...`,
		metadata: threadMeta,
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

	// Forward freqtrade's stdout/stderr line-by-line via WebSocket so the UI
	// can show a live tail under the "Downloading…" comment instead of
	// waiting silently for the container to exit. Lines are not persisted
	// to the DB — they exist only as transient WS events.
	const onProgressLine = (line: string) => {
		publishExperimentEvent({
			experimentId,
			type: "data_fetch.progress",
			payload: { line },
		});
	};
	const result = await runContainer(
		{
			image: ENGINE_IMAGES.freqtrade,
			rm: true,
			volumes: [`${cacheUserDir}:/datacache`],
			command: cmd,
		},
		{ onStdoutLine: onProgressLine, onStderrLine: onProgressLine },
	);

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
		await systemComment({
			experimentId,
			nextAction: "action",
			content:
				`Data-fetch failed for ${proposal.pairs.join(", ")} on ${proposal.exchange}. ` +
				"Check the pair naming and trade mode, then emit a corrected [PROPOSE_DATA_FETCH]. " +
				`Last log lines:\n\`\`\`log\n${tail || "(no output)"}\n\`\`\``,
			metadata: threadMeta,
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

	await systemComment({
		experimentId,
		nextAction: "action",
		content:
			`Downloaded ${fileCount} file(s) for ${proposal.pairs.join(", ")} ` +
			`${proposal.timeframe} from ${proposal.exchange} into shared cache. Dataset registered ` +
			"and linked to this desk. You may now write the strategy and emit [RUN_BACKTEST].",
		metadata: threadMeta,
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
