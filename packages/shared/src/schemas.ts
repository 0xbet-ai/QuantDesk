import { z } from "zod";

export const tradeEntrySchema = z.object({
	pair: z.string(),
	side: z.enum(["buy", "sell"]),
	price: z.number(),
	amount: z.number(),
	pnl: z.number(),
	openedAt: z.string(),
	closedAt: z.string(),
});

export type TradeEntry = z.infer<typeof tradeEntrySchema>;

export const normalizedResultSchema = z.object({
	returnPct: z.number(),
	drawdownPct: z.number(),
	winRate: z.number(),
	totalTrades: z.number(),
	trades: z.array(tradeEntrySchema),
});

export type NormalizedResult = z.infer<typeof normalizedResultSchema>;

export const paperStatusSchema = z.object({
	running: z.boolean(),
	unrealizedPnl: z.number(),
	realizedPnl: z.number(),
	openPositions: z.number(),
	uptime: z.number(),
});

export type PaperStatus = z.infer<typeof paperStatusSchema>;

export const adapterConfigSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("process"),
		cli: z.enum(["claude", "codex"]),
		model: z.string().optional(),
		flags: z.array(z.string()).default([]),
	}),
	z.object({
		type: z.literal("http"),
		url: z.string().url(),
		apiKeyRef: z.string(),
	}),
]);

export type AdapterConfig = z.infer<typeof adapterConfigSchema>;

export const strategyModeSchema = z.enum(["classic", "realtime", "generic"]);
export type StrategyMode = z.infer<typeof strategyModeSchema>;

export const runStatusSchema = z.enum([
	"pending",
	"running",
	"completed",
	"stopped",
	"failed",
	"interrupted",
]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const engineNameSchema = z.enum(["freqtrade", "nautilus", "generic"]);
export type EngineName = z.infer<typeof engineNameSchema>;

