import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { db } from "@quantdesk/db";
import { datasets, deskDatasets, desks, experiments, runs } from "@quantdesk/db/schema";
import { desc, eq } from "drizzle-orm";

interface CreateDatasetInput {
	exchange: string;
	pairs: string[];
	timeframe: string;
	dateRange: { start: string; end: string };
	path: string;
	createdByDeskId?: string | null;
	createdByExperimentId?: string | null;
}

export async function createDataset(input: CreateDatasetInput) {
	const [dataset] = await db.insert(datasets).values(input).returning();
	return dataset!;
}

/** List every dataset in the global catalog, newest first. */
export async function listAllDatasets() {
	const rows = await db
		.select({
			dataset: datasets,
			deskName: desks.name,
			experimentTitle: experiments.title,
			experimentNumber: experiments.number,
		})
		.from(datasets)
		.leftJoin(desks, eq(datasets.createdByDeskId, desks.id))
		.leftJoin(experiments, eq(datasets.createdByExperimentId, experiments.id))
		.orderBy(desc(datasets.createdAt));
	return rows.map((r) => ({
		...r.dataset,
		createdByDeskName: r.deskName,
		createdByExperimentTitle: r.experimentTitle,
		createdByExperimentNumber: r.experimentNumber,
	}));
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
	// Break FK references before the delete.
	// - `desk_datasets` is a join row, safe to remove.
	// - `runs.dataset_id` is nullable — null it out so historical run rows
	//   survive the delete (we only lose the link back to the dataset).
	await db.delete(deskDatasets).where(eq(deskDatasets.datasetId, id));
	await db.update(runs).set({ datasetId: null }).where(eq(runs.datasetId, id));
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
	let absPath = isAbsolute(dataset.path) ? dataset.path : resolve(dataset.path);
	if (!existsSync(absPath)) return null;

	let stats = statSync(absPath);
	// Legacy rows and engine-native downloads store the directory path
	// instead of a single file. Pick the first CSV/JSON inside so the
	// preview endpoint can render something instead of EISDIR.
	if (stats.isDirectory()) {
		const candidates = readdirSync(absPath).filter(
			(f) => f.endsWith(".csv") || f.endsWith(".json"),
		);
		if (candidates.length === 0) return null;
		absPath = join(absPath, candidates[0]!);
		stats = statSync(absPath);
	}
	const content = readFileSync(absPath, "utf-8");

	// JSON branch: OHLCV files stored as arrays of arrays
	// (`[[timestamp, open, high, low, close, volume], ...]`). Freqtrade's
	// download-data writes this shape for every pair, and it's what hits
	// the preview endpoint when a classic desk's dataset is clicked.
	if (absPath.endsWith(".json")) {
		try {
			const parsed = JSON.parse(content);
			if (Array.isArray(parsed) && parsed.length > 0 && Array.isArray(parsed[0])) {
				const width = (parsed[0] as unknown[]).length;
				// Assume OHLCV layout when the row width matches.
				const ohlcvHeaders = ["timestamp", "open", "high", "low", "close", "volume"];
				const headers =
					width === ohlcvHeaders.length
						? ohlcvHeaders
						: Array.from({ length: width }, (_, i) => `col_${i}`);
				const rows = (parsed as unknown[][]).slice(0, limit).map((row) =>
					row.map((cell) => {
						if (typeof cell === "number" || typeof cell === "bigint") {
							return String(cell);
						}
						if (cell == null) return "";
						return typeof cell === "string" ? cell : JSON.stringify(cell);
					}),
				);
				return {
					headers,
					rows,
					totalRows: parsed.length,
					fileSize: stats.size,
				};
			}
			// Array of objects — use the first object's keys as headers.
			if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "object") {
				const headers = Object.keys(parsed[0] as Record<string, unknown>);
				const rows = (parsed as Record<string, unknown>[]).slice(0, limit).map((obj) =>
					headers.map((h) => {
						const v = obj[h];
						if (v == null) return "";
						if (typeof v === "object") return JSON.stringify(v);
						return String(v);
					}),
				);
				return { headers, rows, totalRows: parsed.length, fileSize: stats.size };
			}
			// Fall through to raw text rendering for other JSON shapes.
		} catch {
			/* not valid JSON — fall through to the line splitter below */
		}
	}

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
