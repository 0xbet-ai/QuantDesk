import { db } from "@quantdesk/db";
import { comments, desks, experiments } from "@quantdesk/db/schema";
import { eq } from "drizzle-orm";
import { autoIncrementExperimentNumber } from "./logic.js";

interface CreateDeskInput {
	name: string;
	budget: string;
	targetReturn: string;
	stopLoss: string;
	strategyId?: string;
	venues: string[];
	engine: string;
	config?: Record<string, unknown>;
	description?: string;
}

export async function createDesk(input: CreateDeskInput) {
	const [desk] = await db
		.insert(desks)
		.values({
			name: input.name,
			budget: input.budget,
			targetReturn: input.targetReturn,
			stopLoss: input.stopLoss,
			strategyId: input.strategyId ?? null,
			venues: input.venues,
			engine: input.engine,
			config: input.config ?? {},
			description: input.description ?? null,
		})
		.returning();

	const existingCount = 0;
	const number = autoIncrementExperimentNumber(existingCount);

	const [experiment] = await db
		.insert(experiments)
		.values({
			deskId: desk!.id,
			number,
			title: "Baseline",
			status: "active",
		})
		.returning();

	await db.insert(comments).values({
		experimentId: experiment!.id,
		author: "system",
		content: `Desk created: ${desk!.name}. Strategy: ${input.description ?? input.strategyId ?? "custom"}. Venues: ${input.venues.join(", ")}. Budget: $${input.budget}, target: ${input.targetReturn}%, stop-loss: ${input.stopLoss}%.`,
	});

	return { desk: desk!, experiment: experiment! };
}

export async function listDesks() {
	return db.select().from(desks).orderBy(desks.createdAt);
}

export async function getDesk(id: string) {
	const [desk] = await db.select().from(desks).where(eq(desks.id, id));
	return desk ?? null;
}
