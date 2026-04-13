/**
 * QuantDesk MCP server — phases 27b/c/d.
 *
 * Tools registered (1:1 with the legacy marker protocol):
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
	comments as commentRows,
	datasets,
	deskDatasets,
	desks,
	experiments,
	runs,
} from "@quantdesk/db/schema";
import { getAdapter as getEngineAdapter } from "@quantdesk/engines";
import type { NormalizedResult } from "@quantdesk/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getConfig } from "../config-file.js";
import { publishExperimentEvent } from "../realtime/live-events.js";
import { appendAgentLog } from "../services/agent-log.js";
import type { AgentRole, TriggerAgentOptions } from "../services/agent-trigger.js";
import { systemComment } from "../services/comments.js";
// executeDataFetch kept in data-fetch.ts for reference but no longer
// wired to an MCP tool — see the "data_fetch (REMOVED)" comment below.
import { completeAndCreateNewExperiment, completeExperiment } from "../services/experiments.js";
import { autoIncrementRunNumber, shouldAssignBaseline } from "../services/logic.js";
import {
	getActiveSession as getActivePaperSession,
	getLatestSession as getLatestPaperSession,
	stopPaper as stopPaperService,
} from "../services/paper-sessions.js";
import { goPaper as goPaperService } from "../services/runs.js";
import { getCurrentTurnId } from "../services/turn-context.js";
import { ensureCommit } from "../services/workspace.js";

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
				value: normalized.winRate * 100,
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
let lazyTriggerAgent:
	| ((experimentId: string, role?: AgentRole, options?: TriggerAgentOptions) => Promise<void>)
	| null = null;
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

/**
 * Distinguishes the two ways a Risk Manager turn gets dispatched.
 *
 * - `user_request` — the user explicitly asked to validate a run.
 *   Typical path: the Validate button on the Runs panel posts
 *   "Validate Run #N" into the chat; the analyst reads it and calls
 *   `request_validation`. Rejection hands control back to the user
 *   (they initiated the ask, they read the verdict).
 *
 * - `forced_loop` — the analyst was blocked by the `run_backtest`
 *   sequencing gate ("Run #N has not been reviewed yet") and called
 *   `request_validation` on its own to unblock the iteration budget.
 *   Rejection here retriggers the analyst with the rejection reason
 *   in-context so the Analyst ↔ RM loop can keep negotiating without
 *   pulling the user into every round trip.
 *
 * The detection heuristic lives in `detectValidationSource` and
 * works by reading the most recent user comment before the
 * `request_validation` call. The Validate button emits a literal
 * "Validate Run #N" message, and freeform user messages that start
 * with "validate" are treated the same way.
 */
export type ValidationSource = "user_request" | "forced_loop";

interface ValidationRequestMetadata {
	hidden?: boolean;
	validationRequest?: {
		runId: string;
		runNumber: number;
		requestedByTurnId: string;
		source: ValidationSource;
	};
}

async function detectValidationSource(experimentId: string): Promise<ValidationSource> {
	// Look at the most recent user comment in the experiment. The
	// button path posts a literal "Validate Run #N" — that's the
	// only reliable server-side signal that the user, not the
	// analyst, initiated the validation. Anything else is assumed
	// to be a forced-loop call (the analyst ran into the sequencing
	// gate and is self-unblocking).
	const [latest] = await db
		.select({ content: commentRows.content })
		.from(commentRows)
		.where(and(eq(commentRows.experimentId, experimentId), eq(commentRows.author, "user")))
		.orderBy(desc(commentRows.createdAt))
		.limit(1);
	if (!latest) return "forced_loop";
	if (/^\s*validate\b/i.test(latest.content)) return "user_request";
	return "forced_loop";
}

async function findValidationRun(experimentId: string, runId?: string, runNumber?: number) {
	if (runId) {
		const [requestedRun] = await db
			.select()
			.from(runs)
			.where(and(eq(runs.experimentId, experimentId), eq(runs.id, runId)))
			.limit(1);
		return requestedRun ?? null;
	}

	if (runNumber != null) {
		const [byNumber] = await db
			.select()
			.from(runs)
			.where(and(eq(runs.experimentId, experimentId), eq(runs.runNumber, runNumber)))
			.limit(1);
		return byNumber ?? null;
	}

	const [latestRun] = await db
		.select()
		.from(runs)
		.where(eq(runs.experimentId, experimentId))
		.orderBy(desc(runs.runNumber))
		.limit(1);
	return latestRun ?? null;
}

async function findPendingValidationRequest(experimentId: string) {
	const [awaitingTurn] = await db
		.select({ id: agentTurns.id })
		.from(agentTurns)
		.where(
			and(eq(agentTurns.experimentId, experimentId), eq(agentTurns.status, "awaiting_validation")),
		)
		.orderBy(desc(agentTurns.startedAt))
		.limit(1);
	if (!awaitingTurn) return null;

	const turnComments = await db
		.select({ metadata: commentRows.metadata })
		.from(commentRows)
		.where(eq(commentRows.turnId, awaitingTurn.id))
		.orderBy(desc(commentRows.createdAt));
	for (const comment of turnComments) {
		const meta = comment.metadata as ValidationRequestMetadata | null;
		if (meta?.validationRequest?.runId) {
			return meta.validationRequest;
		}
	}
	return null;
}

export function createQuantdeskMcpServer(ctx: McpServerContext): McpServer {
	const server = new McpServerCtor(
		{ name: "quantdesk", version: "0.1.0" },
		{ capabilities: { tools: {} } },
	);

	// ── data_fetch (REMOVED) ──────────────────────────────────────────
	// `data_fetch` was a wrapper around `engineAdapter.downloadData()`
	// — only freqtrade had an implementation (its `download-data` CLI);
	// nautilus and generic both threw "no server-side downloader". In
	// practice the agent writes its own fetcher script (guided by the
	// venue fetch guide) and runs it via `run_script`, which is more
	// flexible, better error-reported, and engine-agnostic. Unified on
	// `run_script` + `register_dataset` for all engines.

	// ── register_dataset ──────────────────────────────────────────────
	server.registerTool(
		"register_dataset",
		{
			description:
				"Register a dataset that already exists on disk (e.g. produced " +
				"by your fetcher script via run_script) and link it to the current " +
				"desk. MUST be called before run_backtest after you fetch data " +
				"yourself. Pass tradingMode so the catalog can distinguish spot " +
				"from futures — otherwise a futures dataset would collide with " +
				"a spot row that has the same pair / timeframe / window.",
			inputSchema: {
				exchange: z.string().min(1),
				pairs: z.array(z.string().min(1)).min(1),
				timeframe: z.string().min(1),
				tradingMode: z.enum(["spot", "futures", "margin"]).optional(),
				dateRange: z.object({ start: z.string().min(1), end: z.string().min(1) }),
				path: z.string().min(1),
			},
		},
		async (args) => {
			try {
				// Resolve relative paths against the desk workspace so the
				// dataset preview endpoint (which opens `path` directly) can
				// read the file. The agent almost always passes something
				// like `data/hyperliquid/BTC_USDC_USDC-1h.csv` relative to
				// its current working directory, which is the workspace.
				let resolvedPath = args.path;
				if (!resolvedPath.startsWith("/")) {
					const [desk] = await db.select().from(desks).where(eq(desks.id, ctx.deskId));
					if (desk?.workspacePath) {
						const { resolve: pathResolve } = await import("node:path");
						resolvedPath = pathResolve(desk.workspacePath, resolvedPath);
					}
				}
				// Per-pair dedupe + insert. Each pair becomes its own
				// dataset row so the UI can group by exchange → pair.
				// tradingMode is part of the dedupe key so a spot row never
				// shadows a futures row that happens to share pair/window.
				const tradingMode = args.tradingMode ?? "spot";
				const sortedPairs = [...args.pairs].sort();
				const registered: { datasetId: string; pair: string; reused: boolean }[] = [];
				for (const pair of sortedPairs) {
					const [existing] = await db
						.select()
						.from(datasets)
						.where(
							and(
								eq(datasets.exchange, args.exchange),
								eq(datasets.timeframe, args.timeframe),
								eq(datasets.tradingMode, tradingMode),
								sql`${datasets.pairs}::jsonb = ${JSON.stringify([pair])}::jsonb`,
								sql`${datasets.dateRange}->>'start' = ${args.dateRange.start}`,
								sql`${datasets.dateRange}->>'end' = ${args.dateRange.end}`,
							),
						);
					let dataset = existing;
					let reused = false;
					if (dataset) {
						reused = true;
					} else {
						const [inserted] = await db
							.insert(datasets)
							.values({
								exchange: args.exchange,
								pairs: [pair],
								timeframe: args.timeframe,
								tradingMode,
								dateRange: args.dateRange,
								path: resolvedPath,
								// Attribute the dataset to the desk/experiment that
								// registered it so the wizard's "Reuse existing
								// datasets" picker can show origin and the global
								// catalog leftJoin on desks resolves a name. Without
								// these, every agent-registered row stayed orphaned.
								createdByDeskId: ctx.deskId,
								createdByExperimentId: ctx.experimentId,
							})
							.returning();
						if (!inserted) return errorResult("register_dataset: insert returned no row");
						dataset = inserted;
					}
					// Link (idempotent).
					const link = await db
						.select()
						.from(deskDatasets)
						.where(
							and(eq(deskDatasets.deskId, ctx.deskId), eq(deskDatasets.datasetId, dataset.id)),
						);
					if (link.length === 0) {
						await db.insert(deskDatasets).values({
							deskId: ctx.deskId,
							datasetId: dataset.id,
						});
					}
					registered.push({ datasetId: dataset.id, pair, reused });
				}

				// Ensure workspace symlink so the engine container finds
				// the data at the expected path, regardless of where the
				// agent's fetcher actually wrote the files.
				const [deskForLink] = await db.select().from(desks).where(eq(desks.id, ctx.deskId));
				if (deskForLink?.workspacePath) {
					const { join, dirname } = await import("node:path");
					const { existsSync, mkdirSync, symlinkSync, unlinkSync, lstatSync } = await import(
						"node:fs"
					);
					const linkPath = join(deskForLink.workspacePath, "data", args.exchange);
					if (!existsSync(linkPath)) {
						try {
							mkdirSync(dirname(linkPath), { recursive: true });
							symlinkSync(resolvedPath, linkPath, "dir");
						} catch {
							/* best effort — path may already exist as a real dir */
						}
					} else {
						// If it exists but is not a symlink (agent created a real
						// dir), leave it alone — the files are already there.
						try {
							const stat = lstatSync(linkPath);
							if (stat.isSymbolicLink()) {
								unlinkSync(linkPath);
								symlinkSync(resolvedPath, linkPath, "dir");
							}
						} catch {
							/* best effort */
						}
					}
				}

				return textResult(JSON.stringify({ datasets: registered, path: resolvedPath }, null, 2));
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
			// Reserve the run row BEFORE invoking the engine so that parse /
			// post-process failures after a successful docker exit still show
			// up in the Runs list as a `failed` row instead of silently
			// vanishing while the agent summarizes docker stdout as success.
			const [desk] = await db.select().from(desks).where(eq(desks.id, ctx.deskId));
			if (!desk) return errorResult("run_backtest: desk not found");
			if (!desk.workspacePath) return errorResult("run_backtest: desk has no workspace path");

			const linked = await db
				.select({ dataset: datasets })
				.from(deskDatasets)
				.innerJoin(datasets, eq(deskDatasets.datasetId, datasets.id))
				.where(eq(deskDatasets.deskId, desk.id))
				.orderBy(desc(deskDatasets.createdAt));
			if (linked.length === 0) {
				return errorResult(
					"run_backtest: no dataset is registered for this desk. Fetch the data first (write a fetcher script and use run_script), then call register_dataset before calling run_backtest.",
				);
			}

			const existingRuns = await db
				.select()
				.from(runs)
				.where(eq(runs.experimentId, ctx.experimentId));

			// Iteration budget + sequencing (CLAUDE.md: prevent overfitting).
			//
			// Rule: the first successful backtest in an experiment is the
			// "baseline" and runs freely. Every subsequent backtest requires
			// (a) the previous successful run to have an RM verdict on it,
			// and (b) the number of iterations used so far (= completed
			// runs minus the baseline) to be under the configured cap.
			// Failed / errored runs do NOT count — only `completed` ones
			// consume the budget, so exploring broken strategies is free.
			//
			// Motivation: unbounded Analyst iteration degenerates into
			// parameter-fitting on the exact backtest window. Pairing every
			// iteration with an RM review makes the Analyst pay for each
			// attempt with a second opinion, and the hard cap forces it to
			// stop and pick a winner (or pivot) after N cycles.
			const completedBacktests = existingRuns.filter(
				(r) => r.mode === "backtest" && r.status === "completed",
			);
			if (completedBacktests.length > 0) {
				const iterationsUsed = completedBacktests.length - 1; // exclude baseline
				const maxIterations = getConfig().experiments.maxIterationsPerExperiment;
				if (iterationsUsed >= maxIterations) {
					return errorResult(
						`This experiment has exhausted its iteration budget ` +
							`(${maxIterations} Risk Manager ↔ Analyst cycles after the baseline — the ` +
							`baseline itself is free). Reply with how to proceed: call ` +
							`mcp__quantdesk__go_paper on the best run, ` +
							`mcp__quantdesk__new_experiment to test a different hypothesis, ` +
							`or mcp__quantdesk__complete_experiment to close this experiment. ` +
							`Do NOT keep tweaking parameters — further runs on the same ` +
							`dataset would overfit the backtest window.`,
					);
				}
				// Sequencing: the latest completed backtest must have an
				// RM verdict before another backtest can run. This forces
				// the Analyst↔RM cycle — Analyst can't silently burn the
				// budget on runs that aren't even worth reviewing.
				const latest = [...completedBacktests].sort((a, b) => b.runNumber - a.runNumber)[0]!;
				const verdict = (latest.result as Record<string, unknown> | null)?.validation as
					| { verdict?: string }
					| undefined;
				if (!verdict?.verdict) {
					return errorResult(
						`Run #${latest.runNumber} has not been reviewed yet. Call ` +
							`mcp__quantdesk__request_validation({runNumber: ${latest.runNumber}}) ` +
							`and wait for the Risk Manager's verdict before starting another ` +
							`backtest. Baseline is free, but every subsequent iteration must ` +
							`go through Risk Manager review — that's the overfitting guardrail.`,
					);
				}
			}

			const runNumber = autoIncrementRunNumber(existingRuns.length);
			// Baseline is the first COMPLETED backtest, not the first row in
			// the runs table — see `shouldAssignBaseline` for the reasoning.
			const isBaseline = shouldAssignBaseline(existingRuns);
			const runId = crypto.randomUUID();
			const latestDatasetId = linked[0]?.dataset.id ?? null;

			// Snapshot the workspace into a commit BEFORE running the engine so
			// `runs.commit_hash` points at the exact strategy + config that
			// produced this backtest. CLAUDE.md invariant: "each run links to
			// its exact commit hash". If the workspace is clean (agent
			// re-ran with no edits since the previous backtest), we reuse the
			// current HEAD, so multiple runs can legitimately share a hash.
			// Failure here is non-fatal — we fall back to null so the run
			// still executes and the user isn't blocked by a git glitch.
			let commitHash: string | null = null;
			try {
				const [exp] = await db
					.select({ number: experiments.number, title: experiments.title })
					.from(experiments)
					.where(eq(experiments.id, ctx.experimentId));
				const label = exp
					? `Experiment #${exp.number} — ${exp.title} · run #${runNumber}`
					: `run #${runNumber}`;
				commitHash = await ensureCommit(desk.workspacePath, `Agent: pre-run ${label}`);
			} catch {
				/* non-fatal — run proceeds with commit_hash = NULL */
			}

			await db.insert(runs).values({
				id: runId,
				experimentId: ctx.experimentId,
				turnId: getCurrentTurnId() ?? null,
				runNumber,
				isBaseline,
				mode: "backtest",
				status: "running",
				datasetId: latestDatasetId,
				commitHash,
			});
			publishExperimentEvent({
				experimentId: ctx.experimentId,
				type: "run.status",
				payload: { runId, status: "running" },
			});

			try {
				const engineAdapter = getEngineAdapter(desk.engine);
				const externalMountVolumes = (desk.externalMounts ?? []).map(
					(m) => `${m.hostPath}:/workspace/data/external/${m.label}:ro`,
				);

				// Heartbeat proxy: while the Docker container runs, the
				// agent CLI subprocess is blocked waiting for the MCP
				// response and produces zero stream chunks. Without a
				// proxy, the turn's `last_heartbeat_at` goes stale and
				// the watchdog posts a false-positive "heartbeat timeout"
				// system comment — even though the engine is actively
				// running. Fix: every time Docker stdout produces a line,
				// bump the turn heartbeat the same way `streamingSpawn` does
				// for regular CLI chunks. Throttled to one DB write per 5s
				// to avoid hammering Postgres when the engine is chatty.
				const turnId = getCurrentTurnId();
				let lastHeartbeatBump = 0;
				const HEARTBEAT_THROTTLE_MS = 5_000;

				const backtestResult = await engineAdapter.runBacktest({
					strategyPath: args.entrypoint,
					workspacePath: desk.workspacePath,
					runId,
					dataRef: { datasetId: "", path: `${desk.workspacePath}/data` },
					extraParams: {
						strategy: args.strategyName,
						configFile: args.configFile,
					},
					extraVolumes: externalMountVolumes,
					onLogLine: (line, stream) => {
						publishExperimentEvent({
							experimentId: ctx.experimentId,
							type: "run.log_chunk",
							payload: { runId, stream, line },
						});
						// Proxy-bump the agent turn's heartbeat so the
						// watchdog knows the tool call is alive even though
						// the CLI subprocess itself is silent.
						if (turnId) {
							const now = Date.now();
							if (now - lastHeartbeatBump >= HEARTBEAT_THROTTLE_MS) {
								lastHeartbeatBump = now;
								db.update(agentTurns)
									.set({ lastHeartbeatAt: new Date() })
									.where(eq(agentTurns.id, turnId))
									.catch(() => {
										/* best effort */
									});
							}
						}
						appendAgentLog(ctx.experimentId, {
							ts: new Date().toISOString(),
							type: "stdout",
							content: line,
						});
					},
				});

				const resultPayload = normalizedResultToMetrics(backtestResult.normalized);

				// A 0-trade backtest is not a valid result — the strategy
				// never entered a position, so the return/drawdown/win-rate
				// numbers are artefacts of an empty trade list, not a
				// tested edge. Mark the row as failed (freeing the baseline
				// slot for the next attempt) and return an error so the
				// analyst fixes the strategy instead of treating -2.8% as
				// a comparable baseline.
				if (backtestResult.normalized.totalTrades === 0) {
					const zeroTradeReason =
						"Backtest produced 0 trades — the strategy never entered a position. " +
						"Check entry conditions, indicator thresholds, and that the dataset " +
						"date range overlaps with the strategy's active window. Fix the code " +
						"and rerun; this row will not count as a baseline.";
					await db
						.update(runs)
						.set({
							status: "failed",
							// Keep the 0-trade metric payload around so the UI can
							// still surface "why did this fail" in the Runs list
							// without a separate query.
							result: resultPayload,
							error: zeroTradeReason,
							completedAt: new Date(),
						})
						.where(eq(runs.id, runId));
					publishExperimentEvent({
						experimentId: ctx.experimentId,
						type: "run.status",
						payload: { runId, status: "failed", error: zeroTradeReason },
					});
					return errorResult(`run_backtest failed: ${zeroTradeReason}`);
				}

				const [run] = await db
					.update(runs)
					.set({
						status: "completed",
						result: resultPayload,
						completedAt: new Date(),
					})
					.where(eq(runs.id, runId))
					.returning();

				publishExperimentEvent({
					experimentId: ctx.experimentId,
					type: "run.status",
					payload: { runId: run!.id, status: "completed", result: run!.result },
				});

				// Auto-dispatch Risk Manager for every non-baseline run.
				//
				// Historical design (removed): the Analyst had to explicitly
				// call `request_validation` after each iteration, AND had to
				// ask the user for consent first — which meant every single
				// iteration ended with "Should I dispatch the Risk Manager?"
				// in the chat. That was annoying noise that nobody answered
				// "no" to, so we're lifting it out of the conversation
				// entirely: for iteration runs, RM review is mechanical —
				// the sequencing gate already forces it, so we may as well
				// trigger it automatically the moment the backtest lands.
				//
				// Rules:
				//   - Baseline (first completed backtest in the experiment)
				//     never triggers RM. It's a sanity check, not an
				//     iteration — RM has nothing to compare against yet.
				//   - Every subsequent completed backtest dispatches RM
				//     once, with `source = "forced_loop"` so the rejection
				//     path auto-retriggers the Analyst with the rejection
				//     reason in a forcing system comment (no user round-trip).
				//   - The Analyst's return value spells out "RM is running,
				//     end your turn NOW, don't analyze metrics yourself —
				//     the RM will do it and you'll be retriggered with its
				//     verdict in context". This keeps iteration turns short
				//     and prevents the Analyst from burning tokens duplicating
				//     the RM's job.
				if (!run!.isBaseline && lazyTriggerAgent) {
					const turnId = getCurrentTurnId();
					if (turnId) {
						try {
							await db
								.update(agentTurns)
								.set({ status: "awaiting_validation" })
								.where(eq(agentTurns.id, turnId));
							publishExperimentEvent({
								experimentId: ctx.experimentId,
								type: "turn.status",
								payload: {
									turnId,
									status: "awaiting_validation",
									agentRole: "analyst",
								},
							});
							await systemComment({
								experimentId: ctx.experimentId,
								nextAction: "progress",
								content: `Risk Manager auto-dispatched on Run #${run!.runNumber}.`,
								metadata: {
									hidden: true,
									validationRequest: {
										runId: run!.id,
										runNumber: run!.runNumber,
										requestedByTurnId: turnId,
										// Auto-dispatch from run_backtest is always a
										// forced_loop: the agent is self-advancing, not
										// the user asking via the Validate button.
										source: "forced_loop" as const,
									},
								},
							});
							void lazyTriggerAgent(ctx.experimentId, "risk_manager", {
								validationRunId: run!.id,
								validationRunNumber: run!.runNumber,
							}).catch((err) => {
								console.error("Auto-dispatch RM from run_backtest failed:", err);
							});
						} catch (err) {
							console.error("Failed to mark turn awaiting_validation:", err);
						}
					}
					return textResult(
						JSON.stringify(
							{
								runId: run!.id,
								runNumber: run!.runNumber,
								isBaseline: run!.isBaseline,
								metrics: resultPayload.metrics,
								autoDispatched: "risk_manager",
								message:
									`Run #${run!.runNumber} completed. Risk Manager has been ` +
									`automatically dispatched to review it — DO NOT call ` +
									`request_validation yourself, it's already in flight. ` +
									`End your turn NOW with a short one-line acknowledgement ` +
									`(e.g. "Run #${run!.runNumber} 완료, RM 리뷰 중입니다"). ` +
									`Do NOT analyze the metrics in detail — that's the Risk ` +
									`Manager's job and you'll be retriggered with its verdict ` +
									`in context. Do NOT ask the user whether to validate — ` +
									`validation is automatic for every iteration run.`,
							},
							null,
							2,
						),
					);
				}

				// Baseline path: no RM, the Analyst analyzes the result and
				// decides the next iteration freely.
				return textResult(
					JSON.stringify(
						{
							runId: run!.id,
							runNumber: run!.runNumber,
							isBaseline: run!.isBaseline,
							metrics: resultPayload.metrics,
							message: run!.isBaseline
								? `Run #${run!.runNumber} is the baseline — review the metrics, ` +
									`decide your first iteration direction, and call run_backtest ` +
									`again with the improvement. Risk Manager will auto-review ` +
									`every iteration after this one.`
								: undefined,
						},
						null,
						2,
					),
				);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				// Mark the reserved row as failed so the Runs list surfaces
				// parse / artifact failures instead of dropping them.
				await db
					.update(runs)
					.set({
						status: "failed",
						error: message,
						completedAt: new Date(),
					})
					.where(eq(runs.id, runId));
				publishExperimentEvent({
					experimentId: ctx.experimentId,
					type: "run.status",
					payload: { runId, status: "failed", error: message },
				});
				return errorResult(`run_backtest failed: ${message}`);
			}
		},
	);

	// ── run_script ────────────────────────────────────────────────────
	server.registerTool(
		"run_script",
		{
			description:
				"Execute an arbitrary script from the desk workspace inside the " +
				"generic sandbox container (quantdesk/generic) and return its " +
				"raw stdout / stderr / exit code. Available on every desk — the " +
				"script always runs in the sandbox image, not in the desk's " +
				"managed engine container. Use this for fetchers, setup, and " +
				"exploration — anything that is NOT the final backtest (use " +
				"run_backtest for that).",
			inputSchema: {
				scriptPath: z
					.string()
					.min(1)
					.describe("Path to the script, relative to the desk workspace root."),
			},
		},
		async (args) => {
			try {
				const [desk] = await db.select().from(desks).where(eq(desks.id, ctx.deskId));
				if (!desk) return errorResult("run_script: desk not found");
				if (!desk.workspacePath) return errorResult("run_script: desk has no workspace path");
				// Scripts always run in the generic sandbox image regardless
				// of the desk's managed engine — the engine container is
				// reserved for `run_backtest`; agent-authored scripts
				// (fetchers, exploration, etc.) run in `quantdesk/generic`.
				const adapter = getEngineAdapter("generic") as unknown as {
					runScript: (input: {
						workspacePath: string;
						scriptPath: string;
						extraVolumes?: string[];
						onLogLine?: (line: string, stream: "stdout" | "stderr") => void;
					}) => Promise<{
						stdout: string;
						stderr: string;
						exitCode: number;
						containerName: string;
					}>;
				};
				if (typeof adapter.runScript !== "function") {
					return errorResult("run_script: generic adapter is missing runScript");
				}
				const externalMountVolumes = (desk.externalMounts ?? []).map(
					(m) => `${m.hostPath}:/workspace/data/external/${m.label}:ro`,
				);
				// Same heartbeat proxy as run_backtest — long scripts
				// (data fetchers, exploratory notebooks) can run for
				// minutes, and the CLI is silent the whole time.
				const scriptTurnId = getCurrentTurnId();
				let scriptLastBump = 0;

				const result = await adapter.runScript({
					workspacePath: desk.workspacePath,
					scriptPath: args.scriptPath,
					extraVolumes: externalMountVolumes,
					onLogLine: (line, stream) => {
						publishExperimentEvent({
							experimentId: ctx.experimentId,
							type: "run.log_chunk",
							payload: { runId: null, stream, line },
						});
						if (scriptTurnId) {
							const now = Date.now();
							if (now - scriptLastBump >= 5_000) {
								scriptLastBump = now;
								db.update(agentTurns)
									.set({ lastHeartbeatAt: new Date() })
									.where(eq(agentTurns.id, scriptTurnId))
									.catch(() => {});
							}
						}
						appendAgentLog(ctx.experimentId, {
							ts: new Date().toISOString(),
							type: "stdout",
							content: line,
						});
					},
				});
				console.log(
					`[run_script] container=${result.containerName} script=${args.scriptPath} exit=${result.exitCode}`,
				);
				return textResult(
					JSON.stringify(
						{
							exitCode: result.exitCode,
							stdout: result.stdout,
							stderr: result.stderr,
							containerName: result.containerName,
						},
						null,
						2,
					),
				);
			} catch (err) {
				return errorResult(
					`run_script failed: ${err instanceof Error ? err.message : String(err)}`,
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
					return textResult(JSON.stringify({ applied: false, reason: "baseline pinned" }, null, 2));
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
				"Dispatch a Risk Manager turn against a specific run (or the latest " +
				"run when neither runId nor runNumber is given). The Risk Manager " +
				"reads the run metrics, emits an approve/reject verdict via " +
				"submit_rm_verdict, and the analyst is retriggered with the " +
				"verdict in context. Requires prior user consent. " +
				"**Call this exactly once per run.** After calling, end your " +
				"turn — the Risk Manager runs asynchronously and you will be retriggered " +
				"with the verdict. Do NOT call this again while waiting. " +
				"Prefer `runNumber` (the human-readable Run #N from Run History) " +
				"when the user names a specific run; UUIDs are not exposed in " +
				"the prompt.",
			inputSchema: {
				runId: z
					.string()
					.uuid()
					.optional()
					.describe("Optional explicit run UUID. Usually unavailable from prompt context."),
				// LLMs frequently stringify numeric arguments ("22" instead of
				// 22), especially when the user typed the number inline. Use
				// `z.coerce.number()` so the tool accepts both forms — `.int()`
				// and `.positive()` still reject nonsense like "abc".
				runNumber: z.coerce
					.number()
					.int()
					.positive()
					.optional()
					.describe("Optional run number (Run #N) — preferred way to target a specific run."),
			},
		},
		async (args) => {
			try {
				if (!lazyTriggerAgent) return errorResult("triggerAgent not wired");

				// Root cause: validation always walked `latestRun`, so a newer run
				// could silently steal RM review from the run the analyst named.
				const targetRun = await findValidationRun(ctx.experimentId, args.runId, args.runNumber);
				if (!targetRun) {
					return errorResult(
						args.runId || args.runNumber != null
							? "request_validation: run not found in this experiment"
							: "request_validation: no run to validate",
					);
				}

				const result = targetRun.result as Record<string, unknown> | null;
				const validation = result?.validation as { verdict: string } | undefined;
				if (validation?.verdict) {
					// Tell the UI the run's verdict is already in so any
					// in-flight validation spinner (PropsPanel's `validatingRunId`)
					// can clear immediately. Without this the spinner stays stuck
					// because it only listens for run.status events that carry a
					// `validation` payload — which submit_rm_verdict normally
					// publishes, but this early-return path bypasses that flow.
					publishExperimentEvent({
						experimentId: ctx.experimentId,
						type: "run.status",
						payload: {
							runId: targetRun.id,
							status: targetRun.status,
							validation: { verdict: validation.verdict },
						},
					});
					return textResult(
						JSON.stringify(
							{
								already_validated: true,
								verdict: validation.verdict,
								runId: targetRun.id,
								runNumber: targetRun.runNumber,
								message: `Run #${targetRun.runNumber} already has verdict: ${validation.verdict}. No need to re-validate.`,
							},
							null,
							2,
						),
					);
				}

				const pendingValidation = await findPendingValidationRequest(ctx.experimentId);
				if (pendingValidation) {
					return textResult(
						JSON.stringify(
							{
								already_pending: true,
								runId: pendingValidation.runId,
								runNumber: pendingValidation.runNumber,
								message:
									pendingValidation.runId === targetRun.id
										? `Run #${targetRun.runNumber} is already awaiting Risk Manager validation.`
										: `Run #${pendingValidation.runNumber} is already awaiting Risk Manager validation. Wait for that verdict before requesting validation on Run #${targetRun.runNumber}.`,
							},
							null,
							2,
						),
					);
				}

				// Mark the current Analyst turn as awaiting_validation so
				// the UI keeps the input locked until the RM verdict arrives.
				const turnId = getCurrentTurnId();
				if (!turnId) {
					return errorResult("request_validation: no active analyst turn context");
				}
				await db
					.update(agentTurns)
					.set({ status: "awaiting_validation" })
					.where(eq(agentTurns.id, turnId));
				publishExperimentEvent({
					experimentId: ctx.experimentId,
					type: "turn.status",
					payload: { turnId, status: "awaiting_validation", agentRole: "analyst" },
				});
				const validationSource = await detectValidationSource(ctx.experimentId);
				await systemComment({
					experimentId: ctx.experimentId,
					nextAction: "progress",
					content: `Validation requested for Run #${targetRun.runNumber}.`,
					metadata: {
						hidden: true,
						validationRequest: {
							runId: targetRun.id,
							runNumber: targetRun.runNumber,
							requestedByTurnId: turnId,
							source: validationSource,
						},
					},
				});

				void lazyTriggerAgent(ctx.experimentId, "risk_manager", {
					validationRunId: targetRun.id,
					validationRunNumber: targetRun.runNumber,
				}).catch((err) => {
					console.error("request_validation dispatch failed:", err);
				});
				return textResult(
					JSON.stringify(
						{
							dispatched: "risk_manager",
							runId: targetRun.id,
							runNumber: targetRun.runNumber,
							message:
								"Risk Manager is running asynchronously. End your turn now — you will be retriggered with the verdict.",
						},
						null,
						2,
					),
				);
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
				const pendingValidation = await findPendingValidationRequest(ctx.experimentId);
				const targetRun = await findValidationRun(ctx.experimentId, pendingValidation?.runId);
				if (!targetRun) return errorResult("submit_rm_verdict: no run to validate");
				const existing = (targetRun.result as Record<string, unknown> | null) ?? {};
				// Carry a rejection counter so the forced-loop auto-retrigger
				// can bail out after repeated rejects on the SAME run. Reading
				// the prior value lets us distinguish "analyst just got
				// rejected once, let it try again" from "analyst is stuck on
				// this run, kick it back to the user".
				const priorValidation = (existing as Record<string, unknown>).validation as
					| { verdict?: string; rejectionCount?: number }
					| undefined;
				const rejectionCount =
					args.verdict === "reject" ? (priorValidation?.rejectionCount ?? 0) + 1 : 0;
				await db
					.update(runs)
					.set({
						result: {
							...existing,
							validation: {
								verdict: args.verdict,
								reason: args.reason ?? null,
								at: new Date().toISOString(),
								rejectionCount,
							},
						},
					})
					.where(eq(runs.id, targetRun.id));
				// Notify the UI that this run's metadata changed so the
				// PropsPanel refetches and the Validate column re-renders
				// the verdict icon (ShieldCheck/ShieldX) immediately. Without
				// this the panel stays on the last fetched snapshot until the
				// user navigates away or hard-refreshes.
				publishExperimentEvent({
					experimentId: ctx.experimentId,
					type: "run.status",
					payload: {
						runId: targetRun.id,
						status: targetRun.status,
						validation: { verdict: args.verdict },
					},
				});
				// Transition any awaiting_validation analyst turn to completed
				// now that the verdict is in. This unlocks the UI input.
				const awaitingTurns = await db
					.select({ id: agentTurns.id, agentRole: agentTurns.agentRole })
					.from(agentTurns)
					.where(
						and(
							eq(agentTurns.experimentId, ctx.experimentId),
							eq(agentTurns.status, "awaiting_validation"),
						),
					);
				for (const t of awaitingTurns) {
					await db
						.update(agentTurns)
						.set({ status: "completed", endedAt: new Date() })
						.where(eq(agentTurns.id, t.id));
					publishExperimentEvent({
						experimentId: ctx.experimentId,
						type: "turn.status",
						payload: { turnId: t.id, status: "completed", agentRole: t.agentRole },
					});
				}

				// Detect budget exhaustion BEFORE choosing the retrigger
				// branch. Whichever verdict came in, if the iteration budget
				// is now used up we short-circuit into "ask the user what to
				// do" instead of forcing another iteration the Analyst can't
				// run (the next run_backtest would fail the budget gate
				// anyway — handling it here gives the Analyst ONE clean turn
				// to make a recommendation to the user, not two wasted
				// round-trips).
				const completedBacktestsForBudget = await db
					.select({
						id: runs.id,
						runNumber: runs.runNumber,
						isBaseline: runs.isBaseline,
						result: runs.result,
					})
					.from(runs)
					.where(
						and(
							eq(runs.experimentId, ctx.experimentId),
							eq(runs.mode, "backtest"),
							eq(runs.status, "completed"),
						),
					);
				const iterationsUsed = Math.max(0, completedBacktestsForBudget.length - 1);
				const maxIterations = getConfig().experiments.maxIterationsPerExperiment;
				const budgetExhausted = iterationsUsed >= maxIterations;

				async function postBudgetExhaustionAsk(): Promise<void> {
					// Surface the trajectory so the Analyst can give a
					// grounded recommendation without re-reading the whole
					// run history from scratch.
					const approvedRuns = completedBacktestsForBudget
						.filter((r) => {
							const v = (r.result as Record<string, unknown> | null)?.validation as
								| { verdict?: string }
								| undefined;
							return v?.verdict === "approve";
						})
						.map((r) => r.runNumber);
					const approvedSummary =
						approvedRuns.length > 0
							? `Approved runs so far: ${approvedRuns.map((n) => `#${n}`).join(", ")}. `
							: "No runs were approved during this experiment. ";
					await systemComment({
						experimentId: ctx.experimentId,
						nextAction: "action",
						content:
							`Iteration budget exhausted: ${iterationsUsed}/${maxIterations} ` +
							`Risk Manager↔Analyst cycles used after the baseline. ${approvedSummary}` +
							`Review the trajectory of the experiment (are the metrics improving run ` +
							`over run? did any hypothesis get validated?) and reply to the user with ` +
							`ONE clear recommendation and reasoning: ` +
							`(a) call mcp__quantdesk__go_paper on the best approved run if one is strong ` +
							`enough to paper trade, ` +
							`(b) call mcp__quantdesk__new_experiment with a materially different hypothesis ` +
							`(not a parameter tweak on the same idea) if the experiment learned something useful, ` +
							`(c) call mcp__quantdesk__complete_experiment to close this hypothesis out if ` +
							`nothing worked. Present ONE recommendation with a 2-3 sentence rationale and ` +
							`wait for the user to confirm before calling any of those tools — this is the ` +
							`only user touchpoint in the whole iteration loop.`,
					});
				}

				if (args.verdict === "approve") {
					// Approved: hand control back to the analyst. If the
					// budget is also exhausted, the pre-retrigger system
					// comment forces the Analyst to ask the user for the
					// pivot decision instead of silently trying another
					// run_backtest it can't run.
					if (budgetExhausted) {
						await postBudgetExhaustionAsk();
					}
					if (lazyTriggerAgent) {
						void lazyTriggerAgent(ctx.experimentId, "analyst").catch((err) => {
							console.error("Analyst retrigger after verdict failed:", err);
						});
					}
				} else {
					// Rejected. Three sub-paths:
					//
					// 1. **Budget exhausted** — doesn't matter whether the
					//    validation was forced-loop or user-request; the
					//    Analyst cannot run another backtest anyway, so we
					//    skip the "adjust and retry" forcing comment and
					//    inject the budget-exhausted user-ask instead.
					// 2. **Forced loop** (auto-dispatched by `run_backtest`):
					//    auto-retrigger the analyst with the rejection reason
					//    in a forcing system comment so the iteration loop
					//    keeps moving without pulling the user in. Bounded
					//    by `rejectionCount < STRIKE_LIMIT` to prevent the
					//    loop running away on the same run.
					// 3. **User request** (the user clicked Validate or typed
					//    "validate …"): keep the hand-back-to-user flow.
					const source = pendingValidation?.source ?? "forced_loop";
					const STRIKE_LIMIT = 2;

					if (budgetExhausted) {
						await postBudgetExhaustionAsk();
						if (lazyTriggerAgent) {
							void lazyTriggerAgent(ctx.experimentId, "analyst").catch((err) => {
								console.error("Analyst retrigger after exhaustion failed:", err);
							});
						}
					} else if (
						source === "forced_loop" &&
						rejectionCount < STRIKE_LIMIT &&
						lazyTriggerAgent
					) {
						// Auto-negotiate path. The forcing phrase must include
						// an action phrase that satisfies rule #12 so the
						// dead-end lint accepts it — `mcp__quantdesk__` is the
						// approved marker for "go call this tool".
						const rejectionTail = args.reason ?? "(no reason given)";
						await systemComment({
							experimentId: ctx.experimentId,
							nextAction: "action",
							content:
								`Risk Manager rejected Run #${targetRun.runNumber}: ${rejectionTail} ` +
								`This is iteration rejection ${rejectionCount} of ${STRIKE_LIMIT}. ` +
								`Adjust your strategy to address the rejection reason above, then call ` +
								`mcp__quantdesk__run_backtest with the new approach — the Risk Manager ` +
								`will auto-review it. Do NOT call mcp__quantdesk__request_validation ` +
								`again on Run #${targetRun.runNumber}; that run is decided. Ship a ` +
								`materially different change for the next run — parameter micro-tweaks ` +
								`will burn budget without learning anything new.`,
							metadata: {
								hidden: true,
								rmRejection: {
									runId: targetRun.id,
									runNumber: targetRun.runNumber,
									reason: args.reason ?? null,
									rejectionCount,
									source,
								},
							},
						});
						void lazyTriggerAgent(ctx.experimentId, "analyst").catch((err) => {
							console.error("Analyst auto-retrigger after RM reject failed:", err);
						});
					} else {
						// User-handoff path (original behavior). Also the
						// landing spot when the forced-loop 2-strike limit is
						// exceeded — at that point the loop has drifted far
						// enough that the user should weigh in.
						const rejectionSuffix = args.reason ? `: ${args.reason}` : ".";
						const stuckNote =
							source === "forced_loop" && rejectionCount >= STRIKE_LIMIT
								? ` (Run #${targetRun.runNumber} has been rejected ${rejectionCount} times — the auto-loop gave up and is handing back to you.)`
								: "";
						await systemComment({
							experimentId: ctx.experimentId,
							nextAction: "action",
							content: `Risk Manager rejected Run #${targetRun.runNumber}${rejectionSuffix}${stuckNote} Reply with how to proceed (modify the strategy, adjust parameters, or try a different approach).`,
						});
					}
				}
				return textResult(
					JSON.stringify(
						{
							recorded: true,
							runId: targetRun.id,
							runNumber: targetRun.runNumber,
							verdict: args.verdict,
						},
						null,
						2,
					),
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
				// Notify the OLD experiment's WebSocket subscribers so the
				// UI that's still viewing Experiment #N can auto-navigate to
				// the freshly-created Experiment #(N+1). Without this the
				// user stares at a "completed" experiment and has to manually
				// click the new one in the sidebar.
				publishExperimentEvent({
					experimentId: ctx.experimentId,
					type: "experiment.created",
					payload: {
						newExperimentId: next.id,
						newTitle: args.title,
						newNumber: next.number,
					},
				});
				// Also fire experiment.updated on the old experiment so any
				// sidebar list-refresh picks up status=completed immediately.
				publishExperimentEvent({
					experimentId: ctx.experimentId,
					type: "experiment.updated",
					payload: { status: "completed" },
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

	// ── go_paper ─────────────────────────────────────────────────────
	server.registerTool(
		"go_paper",
		{
			description:
				"Promote a completed backtest run to paper trading. Risk Manager " +
				"approval is recommended but not enforced — if the run was rejected, " +
				"surface that to the user explicitly and obtain consent before " +
				"calling this tool. The desk must have no active paper session. " +
				"Requires prior user consent. Returns { sessionId, status } on success.",
			inputSchema: {
				runId: z.string().uuid().describe("The validated run to promote."),
			},
		},
		async (args) => {
			try {
				const paperRun = await goPaperService(args.runId);
				return textResult(JSON.stringify({ runId: paperRun.id, status: "running" }, null, 2));
			} catch (err) {
				return errorResult(`go_paper failed: ${err instanceof Error ? err.message : String(err)}`);
			}
		},
	);

	// ── stop_paper ────────────────────────────────────────────────────
	server.registerTool(
		"stop_paper",
		{
			description:
				"Stop the active paper trading session for this desk. The " +
				"container is gracefully shut down and removed. No retrigger.",
			inputSchema: {},
		},
		async () => {
			try {
				const result = await stopPaperService(ctx.deskId);
				return textResult(JSON.stringify({ stopped: true, sessionId: result.sessionId }, null, 2));
			} catch (err) {
				return errorResult(
					`stop_paper failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		},
	);

	// ── get_paper_status ──────────────────────────────────────────────
	// Agent's ONLY way to verify current paper trading state. Without
	// this, the agent is forced to guess from stale session context and
	// ends up hallucinating "paper is running" when the container was
	// stopped hours ago. Returns either the live session snapshot (with
	// PnL/positions if the container responds) or the latest historical
	// session + an explicit `active: false` so the agent knows.
	server.registerTool(
		"get_paper_status",
		{
			description:
				"Read the current paper trading state for this desk. Returns " +
				"the active session (if any) plus live PnL/positions from the " +
				"engine container; if no session is active, returns the latest " +
				"historical session with `active: false`. Use this ANY time you " +
				"need to answer the user about paper trading — never guess.",
			inputSchema: {},
		},
		async () => {
			try {
				const active = await getActivePaperSession(ctx.deskId);
				if (active) {
					let live: unknown = null;
					if (active.status === "running" && active.containerName) {
						try {
							const [desk] = await db.select().from(desks).where(eq(desks.id, ctx.deskId));
							if (desk) {
								const adapter = getEngineAdapter(desk.engine);
								live = await adapter.getPaperStatus({
									containerName: active.containerName,
									runId: active.runId,
									meta: (active.meta as Record<string, unknown>) ?? {},
								});
							}
						} catch {
							// Container may be temporarily unreachable — leave live null.
						}
					}
					return textResult(
						JSON.stringify(
							{
								active: true,
								sessionId: active.id,
								runId: active.runId,
								status: active.status,
								engine: active.engine,
								containerName: active.containerName,
								apiPort: active.apiPort,
								startedAt: active.startedAt,
								lastStatusAt: active.lastStatusAt,
								live,
							},
							null,
							2,
						),
					);
				}
				const latest = await getLatestPaperSession(ctx.deskId);
				if (!latest) {
					return textResult(
						JSON.stringify(
							{ active: false, message: "No paper session has ever run on this desk." },
							null,
							2,
						),
					);
				}
				return textResult(
					JSON.stringify(
						{
							active: false,
							lastSession: {
								sessionId: latest.id,
								runId: latest.runId,
								status: latest.status,
								engine: latest.engine,
								startedAt: latest.startedAt,
								stoppedAt: latest.stoppedAt,
								error: latest.error,
							},
						},
						null,
						2,
					),
				);
			} catch (err) {
				return errorResult(
					`get_paper_status failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		},
	);

	return server;
}
