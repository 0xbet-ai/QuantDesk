import { existsSync, mkdirSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { db } from "@quantdesk/db";
import { datasets, deskDatasets } from "@quantdesk/db/schema";
import { and, eq, inArray } from "drizzle-orm";

/**
 * Dataset linking utilities.
 *
 * Data fetching itself is the agent's responsibility — it writes a
 * fetcher script and runs it via `run_script`, then calls
 * `register_dataset` to persist the metadata. This file only owns the
 * QuantDesk-level dataset-to-desk linkage:
 *
 *   - global dataset cache root (`~/.quantdesk/datacache`)
 *   - `desk_datasets` join-table management
 *   - workspace symlink (`<workspace>/data/<exchange> → cache`) so
 *     the engine container sees a workspace-local path
 */

const DATA_CACHE_ROOT =
	process.env.QUANTDESK_DATA_CACHE ?? join(homedir(), ".quantdesk", "datacache");

export async function linkDatasetToDesk(deskId: string, datasetId: string) {
	const existingLink = await db
		.select()
		.from(deskDatasets)
		.where(and(eq(deskDatasets.deskId, deskId), eq(deskDatasets.datasetId, datasetId)));
	if (existingLink.length === 0) {
		await db.insert(deskDatasets).values({ deskId, datasetId });
	}
}

/**
 * Link a set of pre-existing datasets to a newly created desk. Used by the
 * desk-creation wizard's "Reuse existing datasets" picker: the user doesn't
 * re-download anything, we just (a) insert `desk_datasets` join rows so the
 * datasets show up in the per-desk list and (b) drop a symlink into the new
 * desk's workspace for every unique exchange so the engine can read the
 * shared cache without caring which desk actually did the download.
 *
 * Silently ignores unknown dataset IDs — the caller is the wizard, and a
 * stale client cache should never block desk creation.
 */
export async function linkExistingDatasetsToDesk(
	deskId: string,
	datasetIds: string[],
	workspaceAbs: string,
) {
	if (datasetIds.length === 0) return;
	const rows = await db.select().from(datasets).where(inArray(datasets.id, datasetIds));
	const exchanges = new Set<string>();
	for (const ds of rows) {
		await linkDatasetToDesk(deskId, ds.id);
		exchanges.add(ds.exchange);
	}
	for (const exchange of exchanges) {
		const exchangeCachePath = join(DATA_CACHE_ROOT, exchange);
		const workspaceDataLink = join(resolve(workspaceAbs), "data", exchange);
		ensureSymlink(exchangeCachePath, workspaceDataLink);
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
		if (existsSync(target)) {
			symlinkSync(target, linkPath, "dir");
		}
	} catch (err) {
		console.error(`Failed to create symlink ${linkPath} → ${target}:`, err);
	}
}
