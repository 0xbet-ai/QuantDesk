import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { getAgentAdapter } from "@quantdesk/adapters";
import { db } from "@quantdesk/db";
import {
	agentSessions,
	comments,
	datasets,
	desks,
	experiments,
	memorySummaries,
	runs,
} from "@quantdesk/db/schema";
import { getAdapter as getEngineAdapter } from "@quantdesk/engines";
import type { NormalizedResult } from "@quantdesk/shared";
import { eq } from "drizzle-orm";
import { publishExperimentEvent } from "../realtime/live-events.js";
import { appendAgentLog, clearAgentLog } from "./agent-log.js";
import { AgentRunner } from "./agent-runner.js";
import { createComment } from "./comments.js";
import { autoIncrementRunNumber } from "./logic.js";
import { commitCode, hasChanges } from "./workspace.js";

/**
 * Parse the `[RUN_BACKTEST]...[/RUN_BACKTEST]` marker emitted by the agent.
 * Returns the parsed payload or null if no marker is present.
 */
function extractRunBacktestRequest(
	text: string,
): { strategyName?: string; configFile?: string } | null {
	const match = text.match(/\[RUN_BACKTEST\]\s*([\s\S]*?)\s*\[\/RUN_BACKTEST\]/);
	if (!match?.[1]) return null;
	const body = match[1].trim();
	if (!body) return {};
	try {
		return JSON.parse(body);
	} catch {
		return {};
	}
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

/**
 * Trigger the agent for a given experiment.
 * Called after a comment is created (user or system).
 * Runs asynchronously — does not block the HTTP response.
 */
export async function triggerAgent(experimentId: string): Promise<void> {
	// 1. Load experiment + desk
	const [experiment] = await db.select().from(experiments).where(eq(experiments.id, experimentId));
	if (!experiment) return;

	const [desk] = await db.select().from(desks).where(eq(desks.id, experiment.deskId));
	if (!desk) return;

	// 2. Load agent session for this desk
	const [session] = await db.select().from(agentSessions).where(eq(agentSessions.deskId, desk.id));
	if (!session) return;

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
	const runBacktestRequest = result.resultText ? extractRunBacktestRequest(result.resultText) : null;
	if (runBacktestRequest && desk.strategyMode !== "generic") {
		try {
			const engineAdapter = getEngineAdapter(desk.engine);
			const existingRuns = await db
				.select()
				.from(runs)
				.where(eq(runs.experimentId, experimentId));
			const runNumber = autoIncrementRunNumber(existingRuns.length);
			const isBaseline = existingRuns.length === 0;
			const runId = crypto.randomUUID();

			const backtestResult = await engineAdapter.runBacktest({
				strategyPath: "strategy.py",
				workspacePath: desk.workspacePath!,
				runId,
				dataRef: { datasetId: "", path: `${desk.workspacePath}/data` },
				extraParams: {
					strategy: runBacktestRequest.strategyName ?? "QuantDeskStrategy",
					configFile: runBacktestRequest.configFile ?? "config.json",
				},
			});

			const resultPayload = normalizedResultToMetrics(backtestResult.normalized);

			const [run] = await db
				.insert(runs)
				.values({
					id: runId,
					experimentId,
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
				payload: { runId: run!.id, status: "completed", result: run!.result },
			});

			// Post a system comment with the result and re-trigger the agent
			// so it can analyse. We embed the result as [BACKTEST_RESULT] so any
			// downstream tools that scan for that marker still see the data.
			await createComment({
				experimentId,
				author: "system",
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
			await createComment({
				experimentId,
				author: "system",
				content: `Backtest request failed: ${message}`,
			});
		}
	}

	// 8. Extract backtest results from agent output and create Run
	if (result.resultText) {
		const backtestMatch = result.resultText.match(
			/\[BACKTEST_RESULT\]\s*([\s\S]*?)\s*\[\/BACKTEST_RESULT\]/,
		);
		if (backtestMatch?.[1]) {
			try {
				const parsed = JSON.parse(backtestMatch[1]);
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
		const datasetMatch = result.resultText.match(/\[DATASET\]\s*([\s\S]*?)\s*\[\/DATASET\]/);
		if (datasetMatch?.[1]) {
			try {
				const parsed = JSON.parse(datasetMatch[1]) as {
					exchange: string;
					pairs: string[];
					timeframe: string;
					dateRange: { start: string; end: string };
					path: string;
				};
				await db.insert(datasets).values({
					deskId: desk.id,
					exchange: parsed.exchange,
					pairs: parsed.pairs,
					timeframe: parsed.timeframe,
					dateRange: parsed.dateRange,
					path: parsed.path,
				});
			} catch {
				/* dataset parse failed, non-fatal */
			}
		}
	}

	// 8c. Extract experiment title from [EXPERIMENT_TITLE] marker and update experiment
	if (result.resultText) {
		const titleMatch = result.resultText.match(/\[EXPERIMENT_TITLE\]\s*(.+?)(?:\n|$)/);
		if (titleMatch?.[1]) {
			const newTitle = titleMatch[1].trim().slice(0, 120);
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

	// 9. Post agent response as comment (strip all markers)
	if (result.resultText) {
		const cleanText = result.resultText
			.replace(/\[BACKTEST_RESULT\][\s\S]*?\[\/BACKTEST_RESULT\]/g, "")
			.replace(/\[RUN_BACKTEST\][\s\S]*?\[\/RUN_BACKTEST\]/g, "")
			.replace(/^\[RUN_PAPER\].*$/gm, "")
			.replace(/\[DATASET\][\s\S]*?\[\/DATASET\]/g, "")
			.replace(/^\[EXPERIMENT_TITLE\].*$/gm, "")
			.trim();
		if (cleanText) {
			await createComment({
				experimentId,
				author: session.agentRole,
				content: cleanText,
			});
		}
	} else if (result.error) {
		const isStopped = result.error.includes("code 143") || result.error.includes("SIGTERM");
		const message = isStopped
			? "Agent was stopped by user."
			: "Something went wrong. Please try again.";
		await createComment({
			experimentId,
			author: "system",
			content: message,
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
}
