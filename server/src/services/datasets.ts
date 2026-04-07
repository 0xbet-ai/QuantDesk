import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { db } from "@quantdesk/db";
import { datasets, deskDatasets } from "@quantdesk/db/schema";
import { desc, eq } from "drizzle-orm";

interface CreateDatasetInput {
	exchange: string;
	pairs: string[];
	timeframe: string;
	dateRange: { start: string; end: string };
	path: string;
}

export async function createDataset(input: CreateDatasetInput) {
	const [dataset] = await db.insert(datasets).values(input).returning();
	return dataset!;
}

/** List every dataset in the global catalog, newest first. */
export async function listAllDatasets() {
	return db.select().from(datasets).orderBy(desc(datasets.createdAt));
}

/** List only the datasets linked to a given desk via `desk_datasets`. */
export async function listDatasets(deskId: string) {
	const rows = await db
		.select({ dataset: datasets })
		.from(deskDatasets)
		.innerJoin(datasets, eq(deskDatasets.datasetId, datasets.id))
		.where(eq(deskDatasets.deskId, deskId))
		.orderBy(desc(deskDatasets.createdAt));
	return rows.map((r) => r.dataset);
}

export async function getDataset(id: string) {
	const [dataset] = await db.select().from(datasets).where(eq(datasets.id, id));
	return dataset ?? null;
}

export async function deleteDataset(id: string) {
	// Remove join rows first to satisfy the FK.
	await db.delete(deskDatasets).where(eq(deskDatasets.datasetId, id));
	const [deleted] = await db.delete(datasets).where(eq(datasets.id, id)).returning();
	return deleted ?? null;
}

interface PreviewResult {
	headers: string[];
	rows: string[][];
	totalRows: number;
	fileSize: number;
}

export async function previewDataset(id: string, limit = 50): Promise<PreviewResult | null> {
	const dataset = await getDataset(id);
	if (!dataset) return null;

	// Dataset.path is an absolute cache path. For legacy rows that stored a
	// workspace-relative path we fall back to trying it as-is.
	const absPath = isAbsolute(dataset.path) ? dataset.path : resolve(dataset.path);
	if (!existsSync(absPath)) return null;

	const stats = statSync(absPath);
	const content = readFileSync(absPath, "utf-8");
	const allLines = content.split("\n").filter((l) => l.length > 0);
	if (allLines.length === 0) {
		return { headers: [], rows: [], totalRows: 0, fileSize: stats.size };
	}

	const headers = allLines[0]!.split(",").map((h) => h.trim());
	const dataLines = allLines.slice(1, 1 + limit);
	const rows = dataLines.map((line) => line.split(",").map((c) => c.trim()));

	return {
		headers,
		rows,
		totalRows: allLines.length - 1,
		fileSize: stats.size,
	};
}
