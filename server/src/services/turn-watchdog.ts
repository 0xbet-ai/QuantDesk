import { db } from "@quantdesk/db";
import { agentTurns } from "@quantdesk/db/schema";
import { and, eq, lt } from "drizzle-orm";
import { publishExperimentEvent } from "../realtime/live-events.js";
import { systemComment } from "./comments.js";

/**
 * Phase 27 — Heartbeat watchdog for `agent_turns`. Any row still in `running`
 * whose `last_heartbeat_at` is older than the threshold belongs to a CLI
 * subprocess that has gone silent (crashed, hung, or lost its pipe). Mark
 * them `failed` with `failure_reason='heartbeat_timeout'` and post a rule #15
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
