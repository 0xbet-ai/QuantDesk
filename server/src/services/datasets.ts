import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { db } from "@quantdesk/db";
import { datasets, desks } from "@quantdesk/db/schema";
import { eq } from "drizzle-orm";

interface CreateDatasetInput {
	deskId: string;
	exchange: string;
	pairs: string[];
	timeframe: string;
	dateRange: { start: string; end: string };
	path: string;
}

export async function createDataset(input: CreateDatasetInput) {
	const [dataset] = await db
		.insert(datasets)
		.values({
			deskId: input.deskId,
			exchange: input.exchange,
			pairs: input.pairs,
			timeframe: input.timeframe,
			dateRange: input.dateRange,
			path: input.path,
		})
		.returning();

	return dataset!;
}

export async function listDatasets(deskId: string) {
	return db.select().from(datasets).where(eq(datasets.deskId, deskId)).orderBy(datasets.createdAt);
}

export async function getDataset(id: string) {
	const [dataset] = await db.select().from(datasets).where(eq(datasets.id, id));
	return dataset ?? null;
}

export async function deleteDataset(id: string) {
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

	const [desk] = await db.select().from(desks).where(eq(desks.id, dataset.deskId));
	if (!desk?.workspacePath) return null;

	// Resolve path: if relative, anchor to the desk's workspace
	const absPath = isAbsolute(dataset.path)
		? dataset.path
		: resolve(join(desk.workspacePath, dataset.path));
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
