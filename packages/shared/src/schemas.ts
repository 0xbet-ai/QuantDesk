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

export const strategyModeSchema = z.enum(["classic", "realtime"]);
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

/**
 * A single run metric. Engine adapters emit a default set (return, max
 * drawdown, win rate, trades); the analyst can append strategy-specific
 * metrics on top via the `record_run_metrics` MCP tool. The UI renders
 * whatever array lands in `run.result.metrics`, so adding a key is the
 * only work needed to surface a new measurement.
 */
export const runMetricSchema = z.object({
	key: z
		.string()
		.min(1)
		.max(64)
		.regex(/^[a-z0-9_][a-z0-9_.-]*$/, {
			message: "metric key must be snake_case (lowercase letters, digits, _, -, .)",
		}),
	label: z.string().min(1).max(64),
	value: z.number().finite(),
	format: z.enum(["percent", "number", "integer", "currency"]),
	tone: z.enum(["positive", "negative", "neutral"]).optional(),
});

export type RunMetric = z.infer<typeof runMetricSchema>;
