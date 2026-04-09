import { db } from "@quantdesk/db";
import { agentTurns, runs } from "@quantdesk/db/schema";
import { and, eq, inArray, lt } from "drizzle-orm";
import { publishExperimentEvent } from "../realtime/live-events.js";
import { systemComment } from "./comments.js";

/**
 * Phase 27 — Heartbeat watchdog for `agent_turns`. Any row still in `running`
 * whose `last_heartbeat_at` is older than the threshold belongs to a CLI
 * subprocess that has gone silent (crashed, hung, or lost its pipe). Mark
 * them `failed` with `failure_reason='heartbeat_timeout'` and post a rule #12
 * system comment on the owning experiment so the user has a clear next move.
 */
const HEARTBEAT_TIMEOUT_MS = 90_000; // 90s of silence = dead
const WATCHDOG_INTERVAL_MS = 30_000; // check every 30s

export async function scanStaleTurns(now: Date = new Date()): Promise<number> {
	const cutoff = new Date(now.getTime() - HEARTBEAT_TIMEOUT_MS);
	const stale = await db
		.update(agentTurns)
		.set({
			status: "failed",
			endedAt: now,
			failureReason: "heartbeat_timeout",
		})
		.where(and(eq(agentTurns.status, "running"), lt(agentTurns.lastHeartbeatAt, cutoff)))
		.returning({ id: agentTurns.id, experimentId: agentTurns.experimentId });

	// Cascade: any backtest runs reserved inside these dead turns are
	// orphaned — the MCP tool handler will never reach its catch block.
	// Mark them failed so the Runs list exits the spinner.
	if (stale.length > 0) {
		const orphanRuns = await db
			.update(runs)
			.set({
				status: "failed",
				error: "heartbeat_timeout",
				completedAt: now,
			})
			.where(
				and(
					eq(runs.status, "running"),
					eq(runs.mode, "backtest"),
					inArray(
						runs.turnId,
						stale.map((t) => t.id),
					),
				),
			)
			.returning({ id: runs.id, experimentId: runs.experimentId });
		for (const r of orphanRuns) {
			publishExperimentEvent({
				experimentId: r.experimentId,
				type: "run.status",
				payload: { runId: r.id, status: "failed", error: "heartbeat_timeout" },
			});
		}
	}

	for (const row of stale) {
		try {
			await systemComment({
				experimentId: row.experimentId,
				nextAction: "action",
				content:
					"Agent stopped responding (heartbeat timeout). Please try again — reply with a new instruction.",
			});
			publishExperimentEvent({
				experimentId: row.experimentId,
				type: "turn.status",
				payload: {
					turnId: row.id,
					status: "failed",
					failureReason: "heartbeat_timeout",
				},
			});
		} catch (err) {
			console.error(`[watchdog] Failed to post stale-turn comment for turn ${row.id}:`, err);
		}
	}

	return stale.length;
}

let timer: NodeJS.Timeout | null = null;

export function startTurnWatchdog(): void {
	if (timer) return;
	timer = setInterval(() => {
		scanStaleTurns().catch((err) => {
			console.error("[watchdog] scanStaleTurns failed:", err);
		});
	}, WATCHDOG_INTERVAL_MS);
	// Don't block process exit on the interval
	timer.unref?.();
}

export function stopTurnWatchdog(): void {
	if (timer) {
		clearInterval(timer);
		timer = null;
	}
}
