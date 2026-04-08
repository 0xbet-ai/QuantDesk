import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
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
	extractDatasetBody,
	extractExperimentTitle,
	extractRmVerdict,
	extractRunBacktestRequest,
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
import { maybeRescueDeadEnd } from "./dead-end-guard.js";
import { autoIncrementRunNumber } from "./logic.js";
import { detectProposals, extractDataFetchProposal, markerToProposalType } from "./triggers.js";
import { getCurrentTurnId, runWithTurn } from "./turn-context.js";
import { commitCode, hasChanges } from "./workspace.js";

/**
 * Find the existing `agent_sessions` row for a (desk, role) pair, or create
 * a fresh one. The analyst session is created at desk creation
 * (`services/desks.ts`); risk_manager sessions are created lazily here on
 * the first `[PROPOSE_VALIDATION]` approval (phase 07).
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

/**
 * Read-only snapshot of experiment IDs that currently have an agent
 * subprocess running. Used by the sidebar to render a "live" indicator
 * without having to subscribe to per-experiment WebSockets for every row.
 */
export function getActiveAgentExperimentIds(): string[] {
	return Array.from(activeAgents.keys());
}

export function stopAgent(experimentId: string): boolean {
	const child = activeAgents.get(experimentId);
	if (child) {
		child.kill("SIGTERM");
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
}

function spawnCli(
	args: string[],
	stdin: string,
	options?: StreamingSpawnOptions,
): Promise<string[]> {
	return new Promise((resolve, reject) => {
		const cmd = args[0]!;
		const child = spawn(cmd, args.slice(1), {
			env: { ...process.env, TERM: "dumb" },
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

export type AgentRole = "analyst" | "risk_manager";

/**
 * Trigger the agent for a given experiment, optionally as a non-default
 * role. Defaults to `"analyst"` for backward compatibility — every existing
 * caller (user comments, system retrigger after backtest, etc.) wakes the
 * analyst. Phase 07 introduces the `"risk_manager"` path via the
 * `[PROPOSE_VALIDATION]` proposal handler.
 *
 * Each role has its own row in `agent_sessions` so the two CLI subprocesses
 * keep independent `sessionId`s and prompt templates. The row is created
 * lazily on first use via `getOrCreateAgentSession`.
 */
export async function triggerAgent(
	experimentId: string,
	role: AgentRole = "analyst",
): Promise<void> {
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

			// 5. Get adapter and build streaming spawn
			const adapter = getAgentAdapter(session.adapterType);

			const streamingSpawn = (args: string[], stdin: string) =>
				spawnCli(args, stdin, {
					cwd: desk.workspacePath ?? undefined,
					experimentId,
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
				// Hard gate: a backtest cannot run without an approved dataset
				// (CLAUDE.md rule #13). Lookup via the desk_datasets join — datasets
				// are global and shared across desks.
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
							"Cannot run backtest: no dataset has been registered for this desk. " +
							"Per rule #13, you must emit [PROPOSE_DATA_FETCH] first and wait for the " +
							"user to approve. Do not write strategy code or emit [RUN_BACKTEST] until " +
							"a 'Downloaded ...' system comment has appeared.",
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
					const backtestResult = await engineAdapter.runBacktest({
						strategyPath: "strategy.py",
						workspacePath: desk.workspacePath!,
						runId,
						dataRef: { datasetId: "", path: `${desk.workspacePath}/data` },
						extraParams: {
							strategy: runBacktestRequest.strategyName ?? "QuantDeskStrategy",
							configFile: runBacktestRequest.configFile ?? "config.json",
						},
						extraVolumes: externalMountVolumes,
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
							exchange: string;
							pairs: string[];
							timeframe: string;
							dateRange: { start: string; end: string };
							path: string;
						};
						const [inserted] = await db
							.insert(datasets)
							.values({
								exchange: parsed.exchange,
								pairs: parsed.pairs,
								timeframe: parsed.timeframe,
								dateRange: parsed.dateRange,
								path: parsed.path,
							})
							.returning();
						if (inserted) {
							await db.insert(deskDatasets).values({
								deskId: desk.id,
								datasetId: inserted.id,
							});
						}
					} catch {
						/* dataset parse failed, non-fatal */
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
			// Attach exactly one `pendingProposal` to the comment metadata so the UI
			// can render Approve/Reject buttons. PROPOSE_DATA_FETCH (a block marker)
			// takes priority because it gates rule #13. The four line-form PROPOSE_*
			// markers are detected via `detectProposals` and the first match wins.
			if (result.resultText) {
				const dataFetchProposal = extractDataFetchProposal(result.resultText);
				const lineProposals = detectProposals(result.resultText);
				const firstLineProposal = lineProposals[0];

				let pendingProposal: { type: string; data: unknown } | undefined;
				if (dataFetchProposal) {
					pendingProposal = { type: "data_fetch", data: dataFetchProposal };
				} else if (firstLineProposal) {
					pendingProposal = {
						type: markerToProposalType(firstLineProposal.type),
						data: { value: firstLineProposal.value },
					};
				}

				const cleanText = stripAgentMarkers(result.resultText);
				// Create the comment when EITHER the agent has visible prose OR a
				// pendingProposal needs to be surfaced as Approve/Reject buttons.
				// Skipping on empty cleanText would lose the proposal metadata and
				// leave the user staring at a blank desk — a CLAUDE.md rule #15
				// dead-end. The UI's comment renderer already handles empty body
				// gracefully (the markdown block is omitted, the proposal card
				// renders standalone).
				if (cleanText || pendingProposal) {
					await createComment({
						experimentId,
						author: session.agentRole,
						content: cleanText,
						metadata: pendingProposal ? { pendingProposal } : undefined,
					});
				}

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

			// 9c. Dead-end guard (CLAUDE.md rule #15, phase 14). If this turn
			// produced no action marker AND the response is a bare acknowledgment,
			// the user has nothing to click — the guard posts a forcing system
			// comment and re-triggers the agent. Capped per-experiment so a
			// permanently broken agent cannot loop forever.
			const hadActionMarker =
				!!result.resultText &&
				(!!extractRunBacktestRequest(result.resultText) ||
					!!extractDataFetchProposal(result.resultText) ||
					!!extractExperimentTitle(result.resultText) ||
					!!extractRmVerdict(result.resultText) ||
					!!extractBacktestResultBody(result.resultText) ||
					!!extractDatasetBody(result.resultText) ||
					detectProposals(result.resultText).length > 0);

			const shouldRescue = await maybeRescueDeadEnd({
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
		}
	});
}
