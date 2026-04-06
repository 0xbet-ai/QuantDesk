import { db } from "@quantdesk/db";
import { experiments } from "@quantdesk/db/schema";
import { eq } from "drizzle-orm";
import { autoIncrementExperimentNumber } from "./logic.js";

interface CreateExperimentInput {
	deskId: string;
	title: string;
	description?: string;
}

export async function createExperiment(input: CreateExperimentInput) {
	const existing = await db.select().from(experiments).where(eq(experiments.deskId, input.deskId));

	const number = autoIncrementExperimentNumber(existing.length);

	const [experiment] = await db
		.insert(experiments)
		.values({
			deskId: input.deskId,
			number,
			title: input.title,
			description: input.description ?? null,
		})
		.returning();

	return experiment!;
}

export async function listExperiments(deskId: string) {
	return db
		.select()
		.from(experiments)
		.where(eq(experiments.deskId, deskId))
		.orderBy(experiments.number);
}

export async function getExperiment(id: string) {
	const [experiment] = await db.select().from(experiments).where(eq(experiments.id, id));
	return experiment ?? null;
}
