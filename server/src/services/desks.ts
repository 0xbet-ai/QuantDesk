import { join } from "node:path";
import { db } from "@quantdesk/db";
import { agentSessions, comments, desks, experiments, strategyCatalog } from "@quantdesk/db/schema";
import { resolveEngine, type VenueEngines } from "@quantdesk/engines";
import type { StrategyMode } from "@quantdesk/shared";
import { eq } from "drizzle-orm";
import venuesCatalog from "../../../strategies/venues.json" with { type: "json" };
import { autoIncrementExperimentNumber } from "./logic.js";
import { initWorkspace } from "./workspace.js";

const WORKSPACES_ROOT = process.env.WORKSPACES_ROOT ?? join(process.cwd(), "workspaces");

const VENUE_MAP = new Map<string, VenueEngines>(
	(venuesCatalog as VenueEngines[]).map((v) => [v.id, v]),
);

interface CreateDeskInput {
	name: string;
	budget: string;
	targetReturn: string;
	stopLoss: string;
	strategyId?: string;
	venues: string[];
	strategyMode: StrategyMode;
	config?: Record<string, unknown>;
	description?: string;
	adapterType?: string;
	adapterConfig?: Record<string, unknown>;
}

function resolveEngineForVenues(venueIds: string[], mode: StrategyMode): string {
	if (venueIds.length === 0) {
		throw new Error("At least one venue is required");
	}
	const engines = new Set<string>();
	for (const id of venueIds) {
		const venue = VENUE_MAP.get(id);
		if (!venue) {
			// Custom venue (not in catalog) — default to generic
			engines.add("generic");
			continue;
		}
		engines.add(resolveEngine(venue, mode));
	}
	if (engines.size > 1) {
		throw new Error(
			`Selected venues require different engines for mode=${mode}: ${[...engines].join(", ")}. Pick venues that share a single engine.`,
		);
	}
	return [...engines][0]!;
}

export async function createDesk(input: CreateDeskInput) {
	const engine = resolveEngineForVenues(input.venues, input.strategyMode);

	const [desk] = await db
		.insert(desks)
		.values({
			name: input.name,
			budget: input.budget,
			targetReturn: input.targetReturn,
			stopLoss: input.stopLoss,
			strategyId: input.strategyId ?? null,
			venues: input.venues,
			strategyMode: input.strategyMode,
			engine,
			config: input.config ?? {},
			description: input.description ?? null,
		})
		.returning();

	// Initialize workspace for this desk
	const workspacePath = await initWorkspace(desk!.id, engine, WORKSPACES_ROOT);
	await db.update(desks).set({ workspacePath }).where(eq(desks.id, desk!.id));

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

	let strategyLabel = "Custom strategy";
	if (input.strategyId) {
		const [catalogEntry] = await db
			.select({ name: strategyCatalog.name })
			.from(strategyCatalog)
			.where(eq(strategyCatalog.id, input.strategyId));
		strategyLabel = catalogEntry?.name ?? input.strategyId;
	}

	await db.insert(comments).values({
		experimentId: experiment!.id,
		author: "analyst",
		content: `Desk created: ${desk!.name}. Strategy: ${strategyLabel}. Venues: ${input.venues.join(", ")}. Budget: $${Number(input.budget).toLocaleString("en-US")}, target: ${input.targetReturn}%, stop-loss: ${input.stopLoss}%.`,
	});

	// Create agent session for this desk
	await db.insert(agentSessions).values({
		deskId: desk!.id,
		agentRole: "analyst",
		adapterType: input.adapterType ?? "claude",
		adapterConfig: input.adapterConfig ?? {},
	});

	return { desk: desk!, experiment: experiment! };
}

export async function listDesks() {
	return db.select().from(desks).where(eq(desks.status, "active")).orderBy(desks.createdAt);
}

export async function getDesk(id: string) {
	const [desk] = await db.select().from(desks).where(eq(desks.id, id));
	return desk ?? null;
}

interface UpdateDeskInput {
	name?: string;
	description?: string;
	budget?: string;
	targetReturn?: string;
	stopLoss?: string;
	venues?: string[];
}

export async function updateDesk(id: string, input: UpdateDeskInput) {
	const updates: Record<string, unknown> = { updatedAt: new Date() };
	if (input.name !== undefined) updates.name = input.name;
	if (input.description !== undefined) updates.description = input.description;
	if (input.budget !== undefined) updates.budget = input.budget;
	if (input.targetReturn !== undefined) updates.targetReturn = input.targetReturn;
	if (input.stopLoss !== undefined) updates.stopLoss = input.stopLoss;
	if (input.venues !== undefined) updates.venues = input.venues;

	const [desk] = await db.update(desks).set(updates).where(eq(desks.id, id)).returning();
	return desk ?? null;
}

export async function archiveDesk(id: string) {
	const [desk] = await db
		.update(desks)
		.set({ status: "archived", updatedAt: new Date() })
		.where(eq(desks.id, id))
		.returning();
	return desk ?? null;
}
