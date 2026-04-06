import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { getAgentAdapter } from "@quantdesk/adapters";
import { db } from "@quantdesk/db";
import {
	agentSessions,
	comments,
	desks,
	experiments,
	memorySummaries,
	runs,
} from "@quantdesk/db/schema";
import { eq } from "drizzle-orm";
import { publishExperimentEvent } from "../realtime/live-events.js";
import { appendAgentLog, clearAgentLog } from "./agent-log.js";
import { AgentRunner } from "./agent-runner.js";
import { createComment } from "./comments.js";
import { autoIncrementRunNumber } from "./logic.js";
import { commitCode, hasChanges } from "./workspace.js";

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

		// Timeout after 10 minutes (agent may write code + run backtests)
		setTimeout(() => {
			child.kill();
			reject(new Error("Agent CLI timed out after 600s"));
		}, 600_000);
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
	appendAgentLog(experimentId, { ts: ts(), type: "system", content: "run started" });
	appendAgentLog(experimentId, { ts: ts(), type: "system", content: "adapter invocation" });

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
			engine: desk.engine,
			venues: desk.venues as string[],
			description: desk.description,
		},
		experiment: { number: experiment.number, title: experiment.title },
		runs: expRuns.map((r) => ({
			runNumber: r.runNumber,
			isBaseline: r.isBaseline,
			result: r.result as {
				returnPct: number;
				drawdownPct: number;
				winRate: number;
				totalTrades: number;
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

	// 8. Extract backtest results from agent output and create Run
	if (result.resultText) {
		const backtestMatch = result.resultText.match(
			/\[BACKTEST_RESULT\]\s*([\s\S]*?)\s*\[\/BACKTEST_RESULT\]/,
		);
		if (backtestMatch?.[1]) {
			try {
				const parsed = JSON.parse(backtestMatch[1]);
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
						result: {
							returnPct: parsed.returnPct,
							drawdownPct: parsed.drawdownPct,
							winRate: parsed.winRate,
							totalTrades: parsed.totalTrades,
						},
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

	// 9. Post agent response as comment (strip backtest markers)
	if (result.resultText) {
		const cleanText = result.resultText
			.replace(/\[BACKTEST_RESULT\][\s\S]*?\[\/BACKTEST_RESULT\]/g, "")
			.trim();
		if (cleanText) {
			await createComment({
				experimentId,
				author: session.agentRole,
				content: cleanText,
			});
		}
	} else if (result.error) {
		await createComment({
			experimentId,
			author: "system",
			content: `Agent error: ${result.error}`,
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
