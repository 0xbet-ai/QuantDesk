import {
	boolean,
	integer,
	jsonb,
	numeric,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";

export const desks = pgTable("desks", {
	id: uuid("id").primaryKey().defaultRandom(),
	name: text("name").notNull(),
	budget: numeric("budget").notNull(),
	targetReturn: numeric("target_return").notNull(),
	stopLoss: numeric("stop_loss").notNull(),
	strategyId: text("strategy_id"),
	venues: jsonb("venues").notNull().$type<string[]>(),
	strategyMode: text("strategy_mode").notNull().default("classic"),
	engine: text("engine").notNull(),
	config: jsonb("config").notNull().$type<Record<string, unknown>>().default({}),
	description: text("description"),
	workspacePath: text("workspace_path"),
	status: text("status").notNull().default("active"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const experiments = pgTable("experiments", {
	id: uuid("id").primaryKey().defaultRandom(),
	deskId: uuid("desk_id")
		.notNull()
		.references(() => desks.id),
	number: integer("number").notNull(),
	title: text("title").notNull(),
	description: text("description"),
	status: text("status").notNull().default("active"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const runs = pgTable("runs", {
	id: uuid("id").primaryKey().defaultRandom(),
	experimentId: uuid("experiment_id")
		.notNull()
		.references(() => experiments.id),
	runNumber: integer("run_number").notNull(),
	isBaseline: boolean("is_baseline").notNull().default(false),
	mode: text("mode").notNull(),
	status: text("status").notNull().default("pending"),
	config: jsonb("config").$type<Record<string, unknown>>().default({}),
	result: jsonb("result").$type<Record<string, unknown>>(),
	commitHash: text("commit_hash"),
	datasetId: uuid("dataset_id").references(() => datasets.id),
	error: text("error"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const runLogs = pgTable("run_logs", {
	id: uuid("id").primaryKey().defaultRandom(),
	runId: uuid("run_id")
		.notNull()
		.references(() => runs.id),
	type: text("type").notNull(),
	data: jsonb("data").notNull().$type<Record<string, unknown>>(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const datasets = pgTable("datasets", {
	id: uuid("id").primaryKey().defaultRandom(),
	deskId: uuid("desk_id")
		.notNull()
		.references(() => desks.id),
	exchange: text("exchange").notNull(),
	pairs: jsonb("pairs").notNull().$type<string[]>(),
	timeframe: text("timeframe").notNull(),
	dateRange: jsonb("date_range").notNull().$type<{ start: string; end: string }>(),
	path: text("path").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const comments = pgTable("comments", {
	id: uuid("id").primaryKey().defaultRandom(),
	experimentId: uuid("experiment_id")
		.notNull()
		.references(() => experiments.id),
	author: text("author").notNull(),
	content: text("content").notNull(),
	runId: uuid("run_id").references(() => runs.id),
	metadata: jsonb("metadata").$type<Record<string, unknown>>(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const agentSessions = pgTable("agent_sessions", {
	id: uuid("id").primaryKey().defaultRandom(),
	deskId: uuid("desk_id")
		.notNull()
		.references(() => desks.id),
	agentRole: text("agent_role").notNull(),
	adapterType: text("adapter_type").notNull(),
	adapterConfig: jsonb("adapter_config").notNull().$type<Record<string, unknown>>(),
	sessionId: text("session_id"),
	totalCost: numeric("total_cost").notNull().default("0"),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memorySummaries = pgTable("memory_summaries", {
	id: uuid("id").primaryKey().defaultRandom(),
	deskId: uuid("desk_id")
		.notNull()
		.references(() => desks.id),
	level: text("level").notNull(),
	experimentId: uuid("experiment_id").references(() => experiments.id),
	content: text("content").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const strategyCatalog = pgTable("strategy_catalog", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	category: text("category").notNull(),
	difficulty: text("difficulty").notNull(),
	description: text("description").notNull(),
	summary: text("summary"),
	indicators: jsonb("indicators").notNull().$type<string[]>(),
	defaultParams: jsonb("default_params").notNull().$type<Record<string, unknown>>(),
	timeframes: jsonb("timeframes").notNull().$type<string[]>(),
	engine: text("engine").notNull(),
	source: text("source"),
});
