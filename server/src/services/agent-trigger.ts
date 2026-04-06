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
import { AgentRunner } from "./agent-runner.js";
import { createComment } from "./comments.js";

function spawnCli(args: string[], stdin: string): Promise<string[]> {
	return new Promise((resolve, reject) => {
		const cmd = args[0]!;
		const child = spawn(cmd, args.slice(1), {
			env: { ...process.env, TERM: "dumb" },
			stdio: ["pipe", "pipe", "pipe"],
		});

		const chunks: Buffer[] = [];
		child.stdout.on("data", (data: Buffer) => chunks.push(data));

		let stderr = "";
		child.stderr.on("data", (data: Buffer) => {
			stderr += data.toString();
		});

		child.on("error", reject);
		child.on("close", (code) => {
			const stdout = Buffer.concat(chunks).toString();
			if (code !== 0) {
				reject(new Error(`CLI exited with code ${code}: ${stderr}`));
			} else {
				resolve(stdout.split("\n").filter((line) => line.trim().length > 0));
			}
		});

		child.stdin.write(stdin);
		child.stdin.end();

		// Timeout after 2 minutes
		setTimeout(() => {
			child.kill();
			reject(new Error("Agent CLI timed out after 120s"));
		}, 120_000);
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

	// 4. Notify UI that agent is thinking
	publishExperimentEvent({
		experimentId,
		type: "agent.thinking",
		payload: { agentRole: session.agentRole },
	});

	// 5. Get adapter and run
	const adapter = getAgentAdapter(session.adapterType);
	const runner = new AgentRunner(adapter, spawnCli);

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

	// 7. Post agent response as comment
	if (result.resultText) {
		await createComment({
			experimentId,
			author: session.agentRole,
			content: result.resultText,
		});
	} else if (result.error) {
		await createComment({
			experimentId,
			author: "system",
			content: `Agent error: ${result.error}`,
		});
	}

	// 8. Notify UI that agent is done
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
