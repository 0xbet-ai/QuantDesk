import { db } from "@quantdesk/db";
import { datasets } from "@quantdesk/db/schema";
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
