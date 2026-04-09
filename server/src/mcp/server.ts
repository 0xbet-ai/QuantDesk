/**
 * QuantDesk MCP server — phases 27b/c/d.
 *
 * Tools registered (1:1 with the legacy marker protocol):
 *   - data_fetch             → replaces [DATA_FETCH]
 *   - register_dataset       → replaces [DATASET]
 *   - run_backtest           → replaces [RUN_BACKTEST] + [BACKTEST_RESULT]
 *   - set_experiment_title   → replaces [EXPERIMENT_TITLE]
 *   - request_validation     → replaces [VALIDATION]
 *   - submit_rm_verdict      → replaces [RM_APPROVE] / [RM_REJECT]
 *   - new_experiment         → replaces [NEW_EXPERIMENT]
 *   - complete_experiment    → replaces [COMPLETE_EXPERIMENT]
 *
 * During phase 27 migration the legacy marker dispatch in agent-trigger.ts
 * is left live as a fallback; this factory gives the agent a second path
 * that returns structured errors on the same turn, avoiding the inject-
 * system-comment-and-retrigger round-trip the markers require.
 *
 * The factory is hosted in-process by the parent server (see
 * `server/src/mcp/http-route.ts`) so tool handlers have direct access
 * to the DB, event emitter, engine adapters, and the `triggerAgent`
 * entry point for chained dispatches.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpServer as McpServerCtor } from "@modelcontextprotocol/sdk/server/mcp.js";
import { db } from "@quantdesk/db";
import {
	agentTurns,
	datasets,
	deskDatasets,
	desks,
	experiments,
	runs,
} from "@quantdesk/db/schema";
import { getAdapter as getEngineAdapter } from "@quantdesk/engines";
import type { NormalizedResult } from "@quantdesk/shared";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { publishExperimentEvent } from "../realtime/live-events.js";
import { systemComment } from "../services/comments.js";
import { executeDataFetch } from "../services/data-fetch.js";
import {
	completeAndCreateNewExperiment,
	completeExperiment,
} from "../services/experiments.js";
import { autoIncrementRunNumber } from "../services/logic.js";
import { getCurrentTurnId } from "../services/turn-context.js";

export interface McpServerContext {
	experimentId: string;
	deskId: string;
}

function normalizedResultToMetrics(normalized: NormalizedResult) {
	return {
		metrics: [
			{
				key: "return",
				label: "Return",
				value: normalized.returnPct,
				format: "percent",
				tone: normalized.returnPct >= 0 ? "positive" : "negative",
			},
			{
				key: "drawdown",
				label: "Max Drawdown",
				value: normalized.drawdownPct,
				format: "percent",
				tone: "negative",
			},
			{
				key: "win_rate",
				label: "Win Rate",
				value: normalized.winRate,
				format: "percent",
			},
			{
				key: "trades",
				label: "Trades",
				value: normalized.totalTrades,
				format: "integer",
			},
		],
	};
}

// Late-bound to break the import cycle with agent-trigger (which imports
// this factory transitively via the http route). Set in index.ts at boot.
// biome-ignore lint/suspicious/noExplicitAny: lazy DI
let lazyTriggerAgent: ((experimentId: string, role?: any) => Promise<void>) | null = null;
export function setTriggerAgent(fn: typeof lazyTriggerAgent) {
	lazyTriggerAgent = fn;
}

function textResult(text: string) {
	return { content: [{ type: "text" as const, text }] };
}
function errorResult(text: string) {
	return {
		isError: true,
		content: [{ type: "text" as const, text }],
	};
}

export function createQuantdeskMcpServer(ctx: McpServerContext): McpServer {
	const server = new McpServerCtor(
		{ name: "quantdesk", version: "0.1.0" },
		{ capabilities: { tools: {} } },
	);

	// ── data_fetch ────────────────────────────────────────────────────
	server.registerTool(
		"data_fetch",
		{
			description:
				"Download market data (OHLCV) for this desk. Blocks until the " +
				"download finishes and returns the registered dataset. Requires " +
				"prior user consent in the conversation (CLAUDE.md rule #13).",
			inputSchema: {
				exchange: z.string().min(1),
				pairs: z.array(z.string().min(1)).min(1),
				timeframe: z.string().min(1),
				days: z.number().int().positive(),
				tradingMode: z.enum(["spot", "margin", "futures"]).optional(),
				rationale: z.string().optional(),
			},
		},
		async (args) => {
			try {
				const dataset = await executeDataFetch({
					experimentId: ctx.experimentId,
					proposal: {
						exchange: args.exchange,
						pairs: args.pairs,
						timeframe: args.timeframe,
						days: args.days,
						tradingMode: args.tradingMode ?? "spot",
						rationale: args.rationale ?? "",
					},
				});
				if (!dataset) {
					return errorResult(
						"data_fetch: no dataset produced (download failed or this strategy mode has no server-side fetcher). Read the system comment for details and try a different exchange / pair / mode, or fall back to writing fetch_data.py yourself and calling register_dataset.",
					);
				}
				return textResult(
					JSON.stringify(
						{
							datasetId: dataset.id,
							exchange: dataset.exchange,
							pairs: dataset.pairs,
							timeframe: dataset.timeframe,
							dateRange: dataset.dateRange,
							path: dataset.path,
						},
						null,
						2,
					),
				);
			} catch (err) {
				return errorResult(
					`data_fetch failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		},
	);

	// ── register_dataset ──────────────────────────────────────────────
	server.registerTool(
		"register_dataset",
		{
			description:
				"Register a dataset that already exists on disk (e.g. produced " +
				"by a workspace-local fetch_data.py) and link it to the current " +
				"desk. MUST be called before run_backtest whenever you downloaded " +
				"data yourself instead of calling data_fetch.",
			inputSchema: {
				exchange: z.string().min(1),
				pairs: z.array(z.string().min(1)).min(1),
				timeframe: z.string().min(1),
				dateRange: z.object({ start: z.string().min(1), end: z.string().min(1) }),
				path: z.string().min(1),
			},
		},
		async (args) => {
			try {
				const [inserted] = await db
					.insert(datasets)
					.values({
						exchange: args.exchange,
						pairs: args.pairs,
						timeframe: args.timeframe,
						dateRange: args.dateRange,
						path: args.path,
					})
					.returning();
				if (!inserted) return errorResult("register_dataset: insert returned no row");
				await db.insert(deskDatasets).values({
					deskId: ctx.deskId,
					datasetId: inserted.id,
				});
				return textResult(
					JSON.stringify({ datasetId: inserted.id, linked: true }, null, 2),
				);
			} catch (err) {
				return errorResult(
					`register_dataset failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		},
	);

	// ── run_backtest ──────────────────────────────────────────────────
	server.registerTool(
		"run_backtest",
		{
			description:
				"Run the current strategy in the engine container and return " +
				"normalized metrics (return, drawdown, win rate, trades). The " +
				"run is persisted and linked to the latest dataset approved for " +
				"this desk. Requires at least one registered dataset.",
			inputSchema: {
				strategyName: z.string().optional(),
				configFile: z.string().optional(),
				entrypoint: z.string().optional(),
			},
		},
		async (args) => {
			try {
				const [desk] = await db.select().from(desks).where(eq(desks.id, ctx.deskId));
				if (!desk) return errorResult("run_backtest: desk not found");
				if (!desk.workspacePath)
					return errorResult("run_backtest: desk has no workspace path");

				const linked = await db
					.select({ dataset: datasets })
					.from(deskDatasets)
					.innerJoin(datasets, eq(deskDatasets.datasetId, datasets.id))
					.where(eq(deskDatasets.deskId, desk.id))
					.orderBy(desc(deskDatasets.createdAt));
				if (linked.length === 0) {
					return errorResult(
						"run_backtest: no dataset is registered for this desk. Call data_fetch (if you want the server to download) or register_dataset (if you already downloaded the data yourself) before calling run_backtest.",
					);
				}

				const engineAdapter = getEngineAdapter(desk.engine);
				const existingRuns = await db
					.select()
					.from(runs)
					.where(eq(runs.experimentId, ctx.experimentId));
				const runNumber = autoIncrementRunNumber(existingRuns.length);
				const isBaseline = existingRuns.length === 0;
				const runId = crypto.randomUUID();

				const externalMountVolumes = (desk.externalMounts ?? []).map(
					(m) => `${m.hostPath}:/workspace/data/external/${m.label}:ro`,
				);

				const backtestResult =
					process.env.MOCK_AGENT === "1"
						? {
								normalized: {
									returnPct: 18.2,
									drawdownPct: -8.7,
									winRate: 0.61,
									totalTrades: 47,
									trades: [],
								},
							}
						: await engineAdapter.runBacktest({
								strategyPath: "strategy.py",
								workspacePath: desk.workspacePath,
								runId,
								dataRef: { datasetId: "", path: `${desk.workspacePath}/data` },
								extraParams: {
									strategy: args.strategyName ?? "QuantDeskStrategy",
									configFile: args.configFile ?? "config.json",
								},
								extraVolumes: externalMountVolumes,
								onLogLine: (line, stream) => {
									publishExperimentEvent({
										experimentId: ctx.experimentId,
										type: "run.log_chunk",
										payload: { runId, stream, line },
									});
								},
							});

				const resultPayload = normalizedResultToMetrics(backtestResult.normalized);
				const latestDatasetId = linked[0]?.dataset.id ?? null;

				const [run] = await db
					.insert(runs)
					.values({
						id: runId,
						experimentId: ctx.experimentId,
						turnId: getCurrentTurnId() ?? null,
						runNumber,
						isBaseline,
						mode: "backtest",
						status: "completed",
						result: resultPayload,
						datasetId: latestDatasetId,
						completedAt: new Date(),
					})
					.returning();

				publishExperimentEvent({
					experimentId: ctx.experimentId,
					type: "run.status",
					payload: { runId: run!.id, status: "completed", result: run!.result },
				});

				return textResult(
					JSON.stringify(
						{
							runId: run!.id,
							runNumber: run!.runNumber,
							isBaseline: run!.isBaseline,
							metrics: resultPayload.metrics,
						},
						null,
						2,
					),
				);
			} catch (err) {
				return errorResult(
					`run_backtest failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		},
	);

	// ── set_experiment_title ──────────────────────────────────────────
	server.registerTool(
		"set_experiment_title",
		{
			description:
				"Rename the current experiment. No-op for Experiment #1 which is " +
				"permanently pinned to 'Baseline'. Title is capped at 120 chars.",
			inputSchema: { title: z.string().min(1).max(120) },
		},
		async (args) => {
			try {
				const [exp] = await db
					.select()
					.from(experiments)
					.where(eq(experiments.id, ctx.experimentId));
				if (!exp) return errorResult("set_experiment_title: experiment not found");
				if (exp.number === 1)
					return textResult(
						JSON.stringify({ applied: false, reason: "baseline pinned" }, null, 2),
					);
				await db
					.update(experiments)
					.set({ title: args.title, updatedAt: new Date() })
					.where(eq(experiments.id, ctx.experimentId));
				publishExperimentEvent({
					experimentId: ctx.experimentId,
					type: "experiment.updated",
					payload: { title: args.title },
				});
				return textResult(JSON.stringify({ applied: true, title: args.title }, null, 2));
			} catch (err) {
				return errorResult(
					`set_experiment_title failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		},
	);

	// ── request_validation ────────────────────────────────────────────
	server.registerTool(
		"request_validation",
		{
			description:
				"Dispatch a Risk Manager turn against the latest run. The RM " +
				"reads the run metrics, emits an approve/reject verdict via " +
				"submit_rm_verdict, and the analyst is retriggered with the " +
				"verdict in context. Requires prior user consent.",
			inputSchema: {},
		},
		async () => {
			try {
				if (!lazyTriggerAgent) return errorResult("triggerAgent not wired");
				void lazyTriggerAgent(ctx.experimentId, "risk_manager").catch((err) => {
					console.error("request_validation dispatch failed:", err);
				});
				return textResult(JSON.stringify({ dispatched: "risk_manager" }, null, 2));
			} catch (err) {
				return errorResult(
					`request_validation failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		},
	);

	// ── submit_rm_verdict (risk_manager only) ─────────────────────────
	server.registerTool(
		"submit_rm_verdict",
		{
			description:
				"Risk Manager only: attach an approve/reject verdict to the " +
				"latest run and hand control back to the analyst. The analyst " +
				"is retriggered with the verdict visible in the prompt.",
			inputSchema: {
				verdict: z.enum(["approve", "reject"]),
				reason: z.string().optional(),
			},
		},
		async (args) => {
			try {
				const [latestRun] = await db
					.select()
					.from(runs)
					.where(eq(runs.experimentId, ctx.experimentId))
					.orderBy(desc(runs.runNumber))
					.limit(1);
				if (!latestRun) return errorResult("submit_rm_verdict: no run to validate");
				const existing = (latestRun.result as Record<string, unknown> | null) ?? {};
				await db
					.update(runs)
					.set({
						result: {
							...existing,
							validation: {
								verdict: args.verdict,
								reason: args.reason ?? null,
								at: new Date().toISOString(),
							},
						},
					})
					.where(eq(runs.id, latestRun.id));
				if (lazyTriggerAgent) {
					void lazyTriggerAgent(ctx.experimentId, "analyst").catch((err) => {
						console.error("Analyst retrigger after verdict failed:", err);
					});
				}
				return textResult(
					JSON.stringify({ recorded: true, verdict: args.verdict }, null, 2),
				);
			} catch (err) {
				return errorResult(
					`submit_rm_verdict failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		},
	);

	// ── new_experiment ────────────────────────────────────────────────
	server.registerTool(
		"new_experiment",
		{
			description:
				"Close the current experiment and open a new one with the given " +
				"title. Requires prior user consent. The analyst is retriggered " +
				"on the new experiment automatically.",
			inputSchema: {
				title: z.string().min(1).max(120),
				hypothesis: z.string().optional(),
			},
		},
		async (args) => {
			try {
				const next = await completeAndCreateNewExperiment({
					currentExperimentId: ctx.experimentId,
					newTitle: args.title,
				});
				if (lazyTriggerAgent) {
					void lazyTriggerAgent(next.id).catch((err) => {
						console.error("Retrigger on new experiment failed:", err);
					});
				}
				return textResult(
					JSON.stringify({ newExperimentId: next.id, title: args.title }, null, 2),
				);
			} catch (err) {
				return errorResult(
					`new_experiment failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		},
	);

	// ── complete_experiment ───────────────────────────────────────────
	server.registerTool(
		"complete_experiment",
		{
			description:
				"Mark the current experiment as finished. Requires prior user " +
				"consent. Does NOT retrigger — the desk is idle until the user " +
				"starts a new experiment or closes the desk.",
			inputSchema: { summary: z.string().optional() },
		},
		async (args) => {
			try {
				await completeExperiment(ctx.experimentId);
				await systemComment({
					experimentId: ctx.experimentId,
					nextAction: "action",
					content:
						"Experiment closed. Reply with the next direction to start a new experiment, or close the desk to finish.",
				});
				if (args.summary) {
					await systemComment({
						experimentId: ctx.experimentId,
						nextAction: "progress",
						content: args.summary,
					});
				}
				// Touch the agent_turns row so the UI reflects progress.
				const current = getCurrentTurnId();
				if (current) {
					await db
						.update(agentTurns)
						.set({ lastHeartbeatAt: new Date() })
						.where(eq(agentTurns.id, current));
				}
				return textResult(JSON.stringify({ closed: true }, null, 2));
			} catch (err) {
				return errorResult(
					`complete_experiment failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		},
	);

	return server;
}
