import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAgentAdapter } from "@quantdesk/adapters";
import { db } from "@quantdesk/db";
import {
	agentSessions,
	agentTurns,
	comments,
	datasets,
	deskDatasets,
	desks,
	experiments,
	memorySummaries,
	runs,
} from "@quantdesk/db/schema";
import { getAdapter as getEngineAdapter } from "@quantdesk/engines";
import {
	extractBacktestResultBody,
	extractCompleteExperimentRequest,
	extractDataFetchRequest,
	extractDatasetBody,
	extractExperimentTitle,
	extractGoPaperRequest,
	extractNewExperimentRequest,
	extractRmVerdict,
	extractRunBacktestRequest,
	extractValidationRequest,
	stripAgentMarkers,
} from "@quantdesk/shared";
import type { NormalizedResult, RmVerdict } from "@quantdesk/shared";

// Re-export for callers that previously imported these from this file
// (e.g. tests). The single owner is `packages/shared/src/agent-markers.ts`.
export { extractRmVerdict };
export type { RmVerdict };
import { and, desc, eq } from "drizzle-orm";
import { publishExperimentEvent } from "../realtime/live-events.js";
import { appendAgentLog, clearAgentLog } from "./agent-log.js";
import { AgentRunner } from "./agent-runner.js";
import { createComment, systemComment } from "./comments.js";
import { executeDataFetch } from "./data-fetch.js";
import { maybeRescueDeadEnd } from "./dead-end-guard.js";
import { completeAndCreateNewExperiment, completeExperiment } from "./experiments.js";
import { autoIncrementRunNumber } from "./logic.js";
import { getCurrentTurnId, runWithTurn } from "./turn-context.js";
import { commitCode, hasChanges } from "./workspace.js";

/**
 * Find the existing `agent_sessions` row for a (desk, role) pair, or create
 * a fresh one. The analyst session is created at desk creation
 * (`services/desks.ts`); risk_manager sessions are created lazily here on
 * the first `[VALIDATION]` turn.
 */
async function getOrCreateAgentSession(
	deskId: string,
	role: "analyst" | "risk_manager",
): Promise<typeof agentSessions.$inferSelect | null> {
	const existing = await db
		.select()
		.from(agentSessions)
		.where(and(eq(agentSessions.deskId, deskId), eq(agentSessions.agentRole, role)));
	if (existing[0]) return existing[0];

	if (role === "analyst") {
		// Analyst is supposed to be seeded at desk creation. If it is missing
		// the desk is in a broken state — surface that loudly rather than
		// papering over it with a default config.
		return null;
	}

	// Risk-manager sessions inherit the analyst's adapter config so the user
	// only configures Claude/Codex once per desk.
	const [analyst] = await db
		.select()
		.from(agentSessions)
		.where(and(eq(agentSessions.deskId, deskId), eq(agentSessions.agentRole, "analyst")));
	if (!analyst) return null;

	const [created] = await db
		.insert(agentSessions)
		.values({
			deskId,
			agentRole: role,
			adapterType: analyst.adapterType,
			adapterConfig: analyst.adapterConfig,
			sessionId: null,
		})
		.returning();
	return created ?? null;
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

// Track running agent processes per experiment
const activeAgents = new Map<string, ChildProcess>();

// Experiments the user has explicitly stopped. Any server-side auto-retrigger
// (backtest-done, RM verdict, dead-end rescue, etc.) is suppressed while this
// flag is set. The flag clears the moment the user posts a new comment —
// sending a new instruction counts as "I want the agent running again".
const stoppedExperiments = new Set<string>();

/**
 * Read-only snapshot of experiment IDs that currently have an agent
 * subprocess running. Used by the sidebar to render a "live" indicator
 * without having to subscribe to per-experiment WebSockets for every row.
 */
export function getActiveAgentExperimentIds(): string[] {
	return Array.from(activeAgents.keys());
}

/** True if the user has pressed Stop on this experiment and hasn't replied yet. */
export function isExperimentStopped(experimentId: string): boolean {
	return stoppedExperiments.has(experimentId);
}

/** Called by the comment route when the user posts a new comment. */
export function clearStopFlag(experimentId: string): void {
	stoppedExperiments.delete(experimentId);
}

export function stopAgent(experimentId: string): boolean {
	stoppedExperiments.add(experimentId);
	const child = activeAgents.get(experimentId);
	if (child) {
		// SIGTERM first, then escalate to SIGKILL a beat later if the
		// process ignores the polite signal (docker clients, CLI wrappers
		// spawning their own subprocesses, etc.).
		child.kill("SIGTERM");
		const killTimer = setTimeout(() => {
			try {
				child.kill("SIGKILL");
			} catch {
				/* already dead */
			}
		}, 1500);
		killTimer.unref?.();
		activeAgents.delete(experimentId);
		publishExperimentEvent({
			experimentId,
			type: "agent.done",
			payload: { agentRole: "analyst", stopped: true },
		});
		return true;
	}
	return false;
}

interface StreamingSpawnOptions {
	onLine?: (line: string) => void;
	cwd?: string;
	experimentId?: string;
	/** Extra env vars merged onto process.env for the subprocess. */
	extraEnv?: Record<string, string>;
}

function spawnCli(
	args: string[],
	stdin: string,
	options?: StreamingSpawnOptions,
): Promise<string[]> {
	return new Promise((resolve, reject) => {
		const cmd = args[0]!;
		const child = spawn(cmd, args.slice(1), {
			env: { ...process.env, TERM: "dumb", ...(options?.extraEnv ?? {}) },
			cwd: options?.cwd,
			stdio: ["pipe", "pipe", "pipe"],
		});

		// Track active agent process
		if (options?.experimentId) {
			activeAgents.set(options.experimentId, child);
			child.on("close", () => activeAgents.delete(options.experimentId!));
		}

		const allLines: string[] = [];
		let buffer = "";

		child.stdout.on("data", (data: Buffer) => {
			buffer += data.toString();
			const lines = buffer.split("\n");
			// Keep the last incomplete line in the buffer
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				if (line.trim().length > 0) {
					allLines.push(line);
					options?.onLine?.(line);
				}
			}
		});

		let stderr = "";
		child.stderr.on("data", (data: Buffer) => {
			stderr += data.toString();
		});

		child.on("error", reject);
		child.on("close", (code) => {
			// Flush remaining buffer
			if (buffer.trim().length > 0) {
				allLines.push(buffer);
				options?.onLine?.(buffer);
			}
			if (code !== 0) {
				reject(new Error(`CLI exited with code ${code}: ${stderr}`));
			} else {
				resolve(allLines);
			}
		});

		child.stdin.write(stdin);
		child.stdin.end();

		// No timeout — agents may run arbitrarily long backtests/optimizations.
		// Users can cancel via the Stop button (sends SIGTERM via stopAgent).
	});
}

/**
 * Phase 27 — generate a temporary MCP config JSON file pointing at the
 * parent server's in-process HTTP MCP endpoint. Returns the absolute
 * path (or null when AGENT_MCP is off). Per-turn context (experimentId,
 * deskId) is carried on request headers so the handler can scope tool
 * side-effects to the correct desk/experiment without any per-process
 * state.
 */
function buildMcpConfigForTurn(experimentId: string, deskId: string): string | null {
	if (process.env.AGENT_MCP !== "1") return null;
	const port = Number(process.env.PORT ?? 3000);
	const url = `http://127.0.0.1:${port}/mcp`;
	const config = {
		mcpServers: {
			quantdesk: {
				type: "http",
				url,
				headers: {
					"X-QuantDesk-Experiment": experimentId,
					"X-QuantDesk-Desk": deskId,
				},
			},
		},
	};
	const dir = mkdtempSync(join(tmpdir(), "quantdesk-mcp-"));
	const path = join(dir, "mcp-config.json");
	writeFileSync(path, JSON.stringify(config, null, 2));
	return path;
}

export type AgentRole = "analyst" | "risk_manager";

/**
 * Trigger the agent for a given experiment, optionally as a non-default
 * role. Defaults to `"analyst"` for backward compatibility — every existing
 * caller (user comments, system retrigger after backtest, etc.) wakes the
 * analyst. The `"risk_manager"` role is activated by a `[VALIDATION]`
 * marker from the analyst.
 *
 * Each role has its own row in `agent_sessions` so the two CLI subprocesses
 * keep independent `sessionId`s and prompt templates. The row is created
 * lazily on first use via `getOrCreateAgentSession`.
 */
export async function triggerAgent(
	experimentId: string,
	role: AgentRole = "analyst",
): Promise<void> {
	// 0. Honour an explicit Stop. stoppedExperiments gets cleared on the
	// next user comment, so this blocks server-side auto-retriggers (dead-
	// end rescue, backtest-done retrigger, RM verdict retrigger, etc.)
	// without requiring every caller to remember the check.
	if (stoppedExperiments.has(experimentId)) {
		return;
	}

	// 1. Load experiment + desk
	const [experiment] = await db.select().from(experiments).where(eq(experiments.id, experimentId));
	if (!experiment) return;

	const [desk] = await db.select().from(desks).where(eq(desks.id, experiment.deskId));
	if (!desk) return;

	// 2. Load agent session for this desk + role (create lazily for non-analyst roles)
	const session = await getOrCreateAgentSession(desk.id, role);
	if (!session) return;

	// Phase 27 — open an `agent_turns` row for this CLI invocation cycle and
	// run the rest of the body under a turn context so downstream
	// `createComment` / run inserts auto-stamp `turn_id`. Final status is set
	// in `finally`. The boot reconcile + heartbeat watchdog (to land in a
	// later sub-step) will mark any row left in `running` as `failed`.
	const [turn] = await db
		.insert(agentTurns)
		.values({
			experimentId,
			deskId: desk.id,
			agentRole: session.agentRole,
			triggerKind: "user_message",
			status: "running",
			agentSessionId: session.id,
		})
		.returning();
	const turnId = turn!.id;
	let turnStatus: "completed" | "failed" | "stopped" = "completed";
	let turnFailureReason: string | null = null;

	publishExperimentEvent({
		experimentId,
		type: "turn.status",
		payload: { turnId, status: "running", agentRole: session.agentRole },
	});

	await runWithTurn(turnId, async () => {
		try {
			// 3. Load context: runs, comments, memory
			const expRuns = await db.select().from(runs).where(eq(runs.experimentId, experimentId));
			const expComments = await db
				.select()
				.from(comments)
				.where(eq(comments.experimentId, experimentId))
				.orderBy(comments.createdAt);
			const memories = await db
				.select()
				.from(memorySummaries)
				.where(eq(memorySummaries.deskId, desk.id));

			// 4. Clear previous log and notify UI that agent is thinking
			clearAgentLog(experimentId);
			const ts = () => new Date().toISOString();

			publishExperimentEvent({
				experimentId,
				type: "agent.thinking",
				payload: { agentRole: session.agentRole },
			});

			// 5. Get adapter and build streaming spawn.
			// `MOCK_AGENT=1` swaps in a deterministic docker-based mock for UI
			// lifecycle debugging. See packages/adapters/src/mock/adapter.ts.
			const adapter = getAgentAdapter(
				process.env.MOCK_AGENT === "1" ? "mock" : session.adapterType,
			);

			const mcpConfigPath = buildMcpConfigForTurn(experimentId, desk.id);
			const mcpEnv: Record<string, string> = {};

			const streamingSpawn = (args: string[], stdin: string) =>
				spawnCli(args, stdin, {
					cwd: desk.workspacePath ?? undefined,
					experimentId,
					extraEnv: mcpEnv,
					onLine: (line) => {
						const chunk = adapter.parseStreamLine(line);
						if (chunk) {
							// Phase 27 — heartbeat: any chunk proves the subprocess is
							// alive, so bump `last_heartbeat_at`. Watchdog (future
							// sub-step) uses this to mark dead turns as failed.
							db.update(agentTurns)
								.set({ lastHeartbeatAt: new Date() })
								.where(eq(agentTurns.id, turnId))
								.catch((err) => {
									console.error("Failed to bump turn heartbeat:", err);
								});

							// Persist to log file
							appendAgentLog(experimentId, {
								ts: ts(),
								...chunk,
							});

							// Save sessionId immediately on init event so timeout/crash
							// can be recovered with --resume on the next message.
							if (chunk.type === "init" && chunk.sessionId) {
								db.update(agentSessions)
									.set({ sessionId: chunk.sessionId, updatedAt: new Date() })
									.where(eq(agentSessions.id, session.id))
									.catch((err) => {
										console.error("Failed to persist sessionId mid-stream:", err);
									});
							}

							publishExperimentEvent({
								experimentId,
								type: "agent.streaming",
								payload: { agentRole: session.agentRole, chunk },
							});
						}
					},
				});

			const runner = new AgentRunner(adapter, streamingSpawn);

			const result = await runner.run({
				desk: {
					name: desk.name,
					budget: desk.budget!,
					targetReturn: desk.targetReturn!,
					stopLoss: desk.stopLoss!,
					strategyMode: (desk.strategyMode as "classic" | "realtime") ?? "classic",
					engine: desk.engine,
					venues: desk.venues as string[],
					description: desk.description,
				},
				experiment: { number: experiment.number, title: experiment.title },
				runs: expRuns.map((r) => ({
					runNumber: r.runNumber,
					isBaseline: r.isBaseline,
					result: r.result as {
						metrics: {
							key: string;
							label: string;
							value: number;
							format: string;
							tone?: string;
						}[];
					} | null,
				})),
				comments: expComments.map((c) => ({ author: c.author, content: c.content })),
				memorySummaries: memories.map((m) => ({ level: m.level, content: m.content })),
				sessionId: session.sessionId ?? undefined,
				agentRole: session.agentRole as "analyst" | "risk_manager",
				mcpConfigPath: mcpConfigPath ?? undefined,
			});

			// 6. Update session ID for resume
			if (result.sessionId) {
				await db
					.update(agentSessions)
					.set({
						sessionId: result.sessionId,
						totalCost: String(Number(session.totalCost) + (result.usage.costUsd ?? 0)),
						updatedAt: new Date(),
					})
					.where(eq(agentSessions.id, session.id));
			}

			// 7. Post-process workspace: commit code changes
			let latestCommitHash: string | null = null;
			if (desk.workspacePath) {
				try {
					const changed = await hasChanges(desk.workspacePath);
					if (changed) {
						latestCommitHash = await commitCode(
							desk.workspacePath,
							`Agent: Experiment #${experiment.number} — ${experiment.title}`,
						);
					}
				} catch {
					/* workspace commit failed, non-fatal */
				}
			}

			// 7b. Handle [RUN_BACKTEST] marker — server runs the engine adapter and
			// creates the Run record, then posts a system comment that will retrigger
			// the agent for analysis.
			//
			// Only classic and realtime modes use this path. Generic mode keeps the
			// existing [BACKTEST_RESULT] flow (agent runs scripts on the host).
			const runBacktestRequest = result.resultText
				? extractRunBacktestRequest(result.resultText)
				: null;
			if (runBacktestRequest && desk.strategyMode !== "generic") {
				// Hard gate: a backtest cannot run without a registered dataset.
				// Lookup via the desk_datasets join — datasets are global and
				// shared across desks.
				const linkedDatasets = await db
					.select({ dataset: datasets, linkedAt: deskDatasets.createdAt })
					.from(deskDatasets)
					.innerJoin(datasets, eq(deskDatasets.datasetId, datasets.id))
					.where(eq(deskDatasets.deskId, desk.id))
					.orderBy(desc(deskDatasets.createdAt));
				if (linkedDatasets.length === 0) {
					await systemComment({
						experimentId,
						nextAction: "action",
						content:
							"Cannot run backtest: no dataset is registered for this desk. " +
							"If you have already downloaded the data yourself (e.g. via a " +
							"`fetch_data.py` script in the workspace), emit a [DATASET] block " +
							"pointing at it so the server can register the row. Otherwise " +
							"ask the user in plain text which data to download and, once " +
							"they agree, emit [DATA_FETCH]. Do not emit [RUN_BACKTEST] until " +
							"one of those two paths has registered a dataset.",
					});
					publishExperimentEvent({ experimentId, type: "comment.new", payload: {} });
					// Do NOT re-trigger here — the user input or next explicit action
					// should drive the next turn, to avoid an infinite retry loop.
					return;
				}
				try {
					const engineAdapter = getEngineAdapter(desk.engine);
					const existingRuns = await db
						.select()
						.from(runs)
						.where(eq(runs.experimentId, experimentId));
					const runNumber = autoIncrementRunNumber(existingRuns.length);
					const isBaseline = existingRuns.length === 0;
					const runId = crypto.randomUUID();

					// Engine images are expected to be pre-pulled via `npx quantdesk onboard`.
					// If the image is missing here, runBacktest will surface a clear error.
					// Phase 10 — desk.externalMounts becomes a list of read-only docker
					// `-v hostPath:/workspace/data/external/<label>:ro` flags appended on
					// top of the workspace mount, so the agent's strategy code can read
					// the user's local datasets without copying.
					const externalMountVolumes = (desk.externalMounts ?? []).map(
						(m) => `${m.hostPath}:/workspace/data/external/${m.label}:ro`,
					);
					// Mock mode: skip the real engine container and return
					// synthetic metrics so UI flows can exercise the full
					// backtest -> run card path without a valid strategy.py in
					// the workspace.
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
									workspacePath: desk.workspacePath!,
									runId,
									dataRef: {
										datasetId: "",
										path: `${desk.workspacePath}/data`,
									},
									extraParams: {
										strategy: runBacktestRequest.strategyName ?? "QuantDeskStrategy",
										configFile: runBacktestRequest.configFile ?? "config.json",
									},
									extraVolumes: externalMountVolumes,
									onLogLine: (line, stream) => {
										publishExperimentEvent({
											experimentId,
											type: "run.log_chunk",
											payload: { runId, stream, line },
										});
									},
								});

					const resultPayload = normalizedResultToMetrics(backtestResult.normalized);

					// Link the run to the most recently approved dataset for this desk.
					const latestDatasetId = linkedDatasets[0]?.dataset.id ?? null;

					const [run] = await db
						.insert(runs)
						.values({
							id: runId,
							experimentId,
							turnId: getCurrentTurnId() ?? null,
							runNumber,
							isBaseline,
							mode: "backtest",
							status: "completed",
							result: resultPayload,
							commitHash: latestCommitHash,
							datasetId: latestDatasetId,
							completedAt: new Date(),
						})
						.returning();

					publishExperimentEvent({
						experimentId,
						type: "run.status",
						payload: { runId: run!.id, status: "completed", result: run!.result },
					});

					// Post a system comment with the result and re-trigger the agent
					// so it can analyse. We embed the result as [BACKTEST_RESULT] so any
					// downstream tools that scan for that marker still see the data.
					await systemComment({
						experimentId,
						nextAction: "retrigger",
						content:
							`Backtest Run #${run!.runNumber} completed.\n\n` +
							"[BACKTEST_RESULT]\n" +
							`${JSON.stringify(resultPayload, null, 2)}\n` +
							"[/BACKTEST_RESULT]",
						runId: run!.id,
					});
					// Re-trigger in the background; the new comment acts as the input.
					void triggerAgent(experimentId).catch((err) => {
						console.error("Follow-up agent trigger failed:", err);
					});
				} catch (err) {
					const message = err instanceof Error ? err.message : "Unknown error";
					await systemComment({
						experimentId,
						nextAction: "retrigger",
						content: `Backtest request failed: ${message}`,
						// Hidden from the UI: the raw freqtrade stderr is noisy and the
						// agent will retrigger and post a clean follow-up. The agent
						// still sees this comment via listComments when building its
						// next prompt.
						metadata: { hidden: true },
					});
					// Re-trigger so the agent sees the failure message and can fix its
					// config / pair naming / strategy and retry.
					void triggerAgent(experimentId).catch((err) => {
						console.error("Follow-up agent trigger failed:", err);
					});
				}
			}

			// 8. Extract backtest results from agent output and create Run
			if (result.resultText) {
				const backtestBody = extractBacktestResultBody(result.resultText);
				if (backtestBody) {
					try {
						const parsed = JSON.parse(backtestBody);
						// Support both new schema (metrics array) and legacy flat schema
						let resultPayload: { metrics: unknown[] };
						if (Array.isArray(parsed.metrics)) {
							resultPayload = { metrics: parsed.metrics };
						} else {
							// Legacy fallback — wrap old shape into the new one
							const legacy: {
								key: string;
								label: string;
								value: number;
								format: string;
								tone?: string;
							}[] = [];
							if (typeof parsed.returnPct === "number") {
								legacy.push({
									key: "return",
									label: "Return",
									value: parsed.returnPct,
									format: "percent",
									tone: "positive",
								});
							}
							if (typeof parsed.drawdownPct === "number") {
								legacy.push({
									key: "drawdown",
									label: "Max Drawdown",
									value: parsed.drawdownPct,
									format: "percent",
									tone: "negative",
								});
							}
							if (typeof parsed.winRate === "number") {
								legacy.push({
									key: "win_rate",
									label: "Win Rate",
									value: parsed.winRate,
									format: "percent",
								});
							}
							if (typeof parsed.totalTrades === "number") {
								legacy.push({
									key: "trades",
									label: "Trades",
									value: parsed.totalTrades,
									format: "integer",
								});
							}
							resultPayload = { metrics: legacy };
						}

						const existingRuns = await db
							.select()
							.from(runs)
							.where(eq(runs.experimentId, experimentId));
						const runNumber = autoIncrementRunNumber(existingRuns.length);
						const isBaseline = existingRuns.length === 0;

						const [run] = await db
							.insert(runs)
							.values({
								experimentId,
								turnId: getCurrentTurnId() ?? null,
								runNumber,
								isBaseline,
								mode: "backtest",
								status: "completed",
								result: resultPayload,
								commitHash: latestCommitHash,
								completedAt: new Date(),
							})
							.returning();

						publishExperimentEvent({
							experimentId,
							type: "run.status",
							payload: {
								runId: run!.id,
								status: "completed",
								result: run!.result,
							},
						});
					} catch {
						/* backtest result parse failed, non-fatal */
					}
				}
			}

			// 8b. Extract dataset info from agent output
			if (result.resultText) {
				const datasetBody = extractDatasetBody(result.resultText);
				if (datasetBody) {
					try {
						const parsed = JSON.parse(datasetBody) as {
							exchange?: string;
							pairs?: string[];
							timeframe?: string;
							dateRange?: { start: string; end: string };
							path?: string;
						};
						const missing: string[] = [];
						if (!parsed.exchange) missing.push("exchange");
						if (!parsed.pairs || parsed.pairs.length === 0) missing.push("pairs");
						if (!parsed.timeframe) missing.push("timeframe");
						if (!parsed.dateRange?.start || !parsed.dateRange?.end)
							missing.push("dateRange.{start,end}");
						if (!parsed.path) missing.push("path");
						if (missing.length > 0) {
							throw new Error(
								`[DATASET] block is missing required field(s): ${missing.join(", ")}`,
							);
						}
						const [inserted] = await db
							.insert(datasets)
							.values({
								exchange: parsed.exchange!,
								pairs: parsed.pairs!,
								timeframe: parsed.timeframe!,
								dateRange: parsed.dateRange!,
								path: parsed.path!,
							})
							.returning();
						if (inserted) {
							await db.insert(deskDatasets).values({
								deskId: desk.id,
								datasetId: inserted.id,
							});
						}
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						console.error("DATASET registration failed:", msg, {
							body: datasetBody,
						});
						await systemComment({
							experimentId,
							nextAction: "action",
							content:
								`Dataset registration failed: ${msg}. ` +
								"Re-emit a valid [DATASET] block with all required fields " +
								"(exchange, pairs, timeframe, dateRange.start, dateRange.end, path).",
						});
					}
				}
			}

			// 8c. Extract experiment title from [EXPERIMENT_TITLE] marker and update experiment.
			// The first experiment of a desk is always pinned to "Baseline" — don't let
			// the agent rename it.
			if (result.resultText && experiment.number !== 1) {
				const rawTitle = extractExperimentTitle(result.resultText);
				if (rawTitle) {
					const newTitle = rawTitle.slice(0, 120);
					if (newTitle && newTitle !== experiment.title) {
						try {
							await db
								.update(experiments)
								.set({ title: newTitle, updatedAt: new Date() })
								.where(eq(experiments.id, experimentId));
							publishExperimentEvent({
								experimentId,
								type: "experiment.updated",
								payload: { title: newTitle },
							});
						} catch {
							/* title update failed, non-fatal */
						}
					}
				}
			}

			// 9. Post agent response as comment (strip all markers).
			// Approval is conversational (CLAUDE.md rule #15): the agent
			// never creates "pending proposal" objects. When the agent needs
			// user consent it asks in plain text and waits. When the user
			// has agreed, the agent's next turn emits the corresponding
			// action marker (DATA_FETCH, VALIDATION, NEW_EXPERIMENT,
			// COMPLETE_EXPERIMENT, GO_PAPER) and the server executes it
			// directly — no approve/reject buttons, no metadata.
			//
			// We DO tag the comment with a `firedMarkers` array listing
			// which action markers appeared in the agent's raw output so
			// the UI can render a small chip next to the comment. The
			// chip is informational only — no buttons, no pending
			// proposal state.
			let currentCommentId: string | undefined;
			if (result.resultText) {
				const cleanText = stripAgentMarkers(result.resultText);
				const firedMarkers: string[] = [];
				if (extractDataFetchRequest(result.resultText)) firedMarkers.push("DATA_FETCH");
				if (extractDatasetBody(result.resultText)) firedMarkers.push("DATASET");
				if (extractRunBacktestRequest(result.resultText)) firedMarkers.push("RUN_BACKTEST");
				if (extractBacktestResultBody(result.resultText)) firedMarkers.push("BACKTEST_RESULT");
				if (extractExperimentTitle(result.resultText)) firedMarkers.push("EXPERIMENT_TITLE");
				if (extractValidationRequest(result.resultText)) firedMarkers.push("VALIDATION");
				if (extractNewExperimentRequest(result.resultText)) firedMarkers.push("NEW_EXPERIMENT");
				if (extractCompleteExperimentRequest(result.resultText))
					firedMarkers.push("COMPLETE_EXPERIMENT");
				if (extractGoPaperRequest(result.resultText)) firedMarkers.push("GO_PAPER");
				if (cleanText) {
					const created = await createComment({
						experimentId,
						author: session.agentRole,
						content: cleanText,
						metadata: firedMarkers.length > 0 ? { firedMarkers } : undefined,
					});
					currentCommentId = created.id;
				}
			}

			// 9a. Direct action markers that run NOW — the agent asked the
			// user in a previous turn, the user agreed, and this turn is
			// the execution step.
			if (result.resultText) {
				const dataFetchRequest = extractDataFetchRequest(result.resultText);
				if (dataFetchRequest) {
					try {
						await executeDataFetch({
							experimentId,
							proposal: dataFetchRequest,
							parentCommentId: currentCommentId,
						});
						void triggerAgent(experimentId).catch((err) => {
							console.error("Retrigger after DATA_FETCH failed:", err);
						});
					} catch (err) {
						console.error("DATA_FETCH execution failed:", err);
						await systemComment({
							experimentId,
							nextAction: "action",
							content: `Data fetch failed: ${
								err instanceof Error ? err.message : String(err)
							}. Reply with different parameters and try again.`,
							metadata: currentCommentId ? { parentCommentId: currentCommentId } : undefined,
						});
					}
				}

				if (extractValidationRequest(result.resultText)) {
					void triggerAgent(experimentId, "risk_manager").catch((err) => {
						console.error("Risk-manager dispatch after VALIDATION failed:", err);
					});
				}

				const newExperimentRequest = extractNewExperimentRequest(result.resultText);
				if (newExperimentRequest) {
					try {
						const newExperiment = await completeAndCreateNewExperiment({
							currentExperimentId: experimentId,
							newTitle: newExperimentRequest.title,
						});
						void triggerAgent(newExperiment.id).catch((err) => {
							console.error("Retrigger after NEW_EXPERIMENT failed:", err);
						});
					} catch (err) {
						console.error("NEW_EXPERIMENT execution failed:", err);
					}
				}

				if (extractCompleteExperimentRequest(result.resultText)) {
					try {
						await completeExperiment(experimentId);
						await systemComment({
							experimentId,
							nextAction: "action",
							content:
								"Experiment closed. Reply with the next direction to start a new " +
								"experiment, or close the desk to finish.",
						});
					} catch (err) {
						console.error("COMPLETE_EXPERIMENT execution failed:", err);
					}
				}
			}

			if (result.resultText) {
				// 9b. Risk Manager verdict loop-back (phase 08).
				// If this turn was the RM, parse the verdict marker and:
				//   - record the verdict on the latest run's `result.validation`
				//   - retrigger the analyst so the next analyst turn sees the verdict
				// The analyst (and the future RUN_PAPER guard) reads
				// `result.validation.verdict === "approve"` to decide whether paper
				// trading is unlocked.
				if (session.agentRole === "risk_manager") {
					const verdict = extractRmVerdict(result.resultText);
					if (verdict) {
						const [latestRun] = await db
							.select()
							.from(runs)
							.where(eq(runs.experimentId, experimentId))
							.orderBy(desc(runs.runNumber))
							.limit(1);
						if (latestRun) {
							const existingResult = (latestRun.result as Record<string, unknown> | null) ?? {};
							const nextResult = {
								...existingResult,
								validation: {
									verdict: verdict.verdict,
									reason: verdict.reason,
									at: new Date().toISOString(),
								},
							};
							await db.update(runs).set({ result: nextResult }).where(eq(runs.id, latestRun.id));
						}
						// Retrigger analyst — the new RM comment is the input.
						// RM never retriggers itself.
						void triggerAgent(experimentId, "analyst").catch((err) => {
							console.error("Analyst retrigger after RM verdict failed:", err);
						});
					}
				}
			} else if (result.error) {
				const isStopped = result.error.includes("code 143") || result.error.includes("SIGTERM");
				if (isStopped) {
					turnStatus = "stopped";
					turnFailureReason = "user_stop";
					await systemComment({
						experimentId,
						nextAction: "action",
						content: "Agent was stopped by user. Reply with a new instruction to continue.",
					});
				} else {
					turnStatus = "failed";
					turnFailureReason = result.error.slice(0, 500);
					await systemComment({
						experimentId,
						nextAction: "action",
						content: "Something went wrong. Please try again.",
					});
				}
			}

			// 9c. Dead-end guard (CLAUDE.md rule #14, phase 14). If this turn
			// produced no action marker AND the response is a bare acknowledgment,
			// the user has nothing to click — the guard posts a forcing system
			// comment and re-triggers the agent. Capped per-experiment so a
			// permanently broken agent cannot loop forever.
			const hadActionMarker =
				!!result.resultText &&
				(!!extractRunBacktestRequest(result.resultText) ||
					!!extractDataFetchRequest(result.resultText) ||
					!!extractExperimentTitle(result.resultText) ||
					!!extractRmVerdict(result.resultText) ||
					!!extractBacktestResultBody(result.resultText) ||
					!!extractDatasetBody(result.resultText) ||
					extractValidationRequest(result.resultText) ||
					!!extractNewExperimentRequest(result.resultText) ||
					extractCompleteExperimentRequest(result.resultText));

			// MOCK_AGENT scenarios are deterministic and intentionally produce
			// no markers, so the dead-end guard would loop forever rescuing
			// them. Skip the guard entirely under MOCK_AGENT.
			const shouldRescue =
				process.env.MOCK_AGENT === "1"
					? false
					: await maybeRescueDeadEnd({
							experimentId,
							resultText: result.resultText,
							hadMarker: hadActionMarker,
						});
			if (shouldRescue) {
				publishExperimentEvent({ experimentId, type: "comment.new", payload: {} });
				void triggerAgent(experimentId).catch((err) => {
					console.error("Dead-end rescue retrigger failed:", err);
				});
			}

			// 10. Notify UI that agent is done
			publishExperimentEvent({
				experimentId,
				type: "agent.done",
				payload: { agentRole: session.agentRole },
			});

			publishExperimentEvent({
				experimentId,
				type: "comment.new",
				payload: {},
			});
		} catch (err) {
			// Phase 27 — any uncaught error marks the turn as failed. The caller
			// (trigger fan-out) already logs; we just record the reason on the
			// row so the UI can surface it.
			turnStatus = "failed";
			turnFailureReason = err instanceof Error ? err.message.slice(0, 500) : "unknown_error";
			try {
				await systemComment({
					experimentId,
					nextAction: "action",
					content:
						`Agent turn failed: ${turnFailureReason}. ` +
						"Reply with a new instruction to continue.",
				});
				publishExperimentEvent({ experimentId, type: "comment.new", payload: {} });
			} catch (commentErr) {
				console.error("Failed to post failure system comment:", commentErr);
			}
			throw err;
		} finally {
			await db
				.update(agentTurns)
				.set({
					status: turnStatus,
					endedAt: new Date(),
					failureReason: turnFailureReason,
				})
				.where(eq(agentTurns.id, turnId))
				.catch((e) => {
					console.error("Failed to finalize agent_turns row:", e);
				});
			publishExperimentEvent({
				experimentId,
				type: "turn.status",
				payload: {
					turnId,
					status: turnStatus,
					failureReason: turnFailureReason,
				},
			});
		}
	});
}
