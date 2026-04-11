import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
import { stripAgentMarkers } from "@quantdesk/shared";
import { and, eq, gte } from "drizzle-orm";
import { publishExperimentEvent } from "../realtime/live-events.js";
import { appendAgentLog, clearAgentLog } from "./agent-log.js";
import { AgentRunner } from "./agent-runner.js";
import { createComment, systemComment } from "./comments.js";
import { maybeRescueDeadEnd } from "./dead-end-guard.js";
import { getLatestSession as getLatestPaperSession } from "./paper-sessions.js";
import type { PaperSessionContext } from "./prompts/types.js";
import { runWithTurn } from "./turn-context.js";
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
/**
 * Resolve the QuantDesk server's own install root. The agent subprocess is
 * executed with `cwd = desk.workspacePath`, but the CLI's Read/Edit/Bash
 * tools accept absolute paths regardless of cwd. We emit a per-turn Claude
 * settings file that denies tool access to this root, so the agent cannot
 * peek at `doc/`, `server/`, `packages/`, `ui/` — none of which exist in
 * production deployments anyway.
 *
 * Detected once at module load from `import.meta.url`. Layout:
 *   <repoRoot>/server/src/services/agent-trigger.ts  → climb 4 levels.
 */
const QUANTDESK_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

function buildClaudeSettingsForTurn(workspacePath: string): string {
	const denyRoots = new Set<string>([QUANTDESK_REPO_ROOT]);
	// If the workspace lives inside the repo root (dev scenario), don't deny
	// the workspace itself — only the siblings above it.
	const settings = {
		permissions: {
			deny: [
				// Block script interpreters and network fetchers so the agent
				// can't bypass MCP tools (run_script, run_backtest) by shelling
				// out to python/node/curl. Basic navigation commands (ls, cd,
				// grep, find, cat, head, tail, pwd, echo) remain allowed.
				"Bash(python:*)",
				"Bash(python3:*)",
				"Bash(node:*)",
				"Bash(npx:*)",
				"Bash(sh:*)",
				"Bash(bash:*)",
				"Bash(zsh:*)",
				"Bash(curl:*)",
				"Bash(wget:*)",
				...Array.from(denyRoots).flatMap((root) => {
					const scope = `${root}/**`;
					return [
						`Read(${scope})`,
						`Edit(${scope})`,
						`Write(${scope})`,
						`Bash(cat:${scope})`,
						`Bash(less:${scope})`,
						`Bash(head:${scope})`,
						`Bash(tail:${scope})`,
					];
				}),
			],
			// Re-allow the workspace so nested-dev layouts keep working.
			allow: [
				`Read(${workspacePath}/**)`,
				`Edit(${workspacePath}/**)`,
				`Write(${workspacePath}/**)`,
			],
		},
	};
	const dir = mkdtempSync(join(tmpdir(), "quantdesk-settings-"));
	const path = join(dir, "settings.json");
	writeFileSync(path, JSON.stringify(settings, null, 2));
	return path;
}

function buildMcpConfigForTurn(experimentId: string, deskId: string): string {
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

export interface TriggerAgentOptions {
	validationRunId?: string;
	validationRunNumber?: number;
}

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
	options: TriggerAgentOptions = {},
): Promise<void> {
	// 0. Honour an explicit Stop. stoppedExperiments gets cleared on the
	// next user comment, so this blocks server-side auto-retriggers (dead-
	// end rescue, backtest-done retrigger, RM verdict retrigger, etc.)
	// without requiring every caller to remember the check.
	if (stoppedExperiments.has(experimentId)) {
		return;
	}
	if (role === "analyst") {
		const [awaitingValidationTurn] = await db
			.select({ id: agentTurns.id })
			.from(agentTurns)
			.where(
				and(
					eq(agentTurns.experimentId, experimentId),
					eq(agentTurns.status, "awaiting_validation"),
				),
			)
			.limit(1);
		if (awaitingValidationTurn) {
			return;
		}
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
			// 3. Load context: runs, comments, memory, paper session
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
			// Paper session snapshot injected into the prompt so the agent
			// never hallucinates "still running" from stale session context.
			// We load the LATEST (any status) row, not only active, so the
			// agent also knows when the user-visible state is "stopped" /
			// "failed". Paper sessions are per-desk so the row may belong
			// to a different experiment — query the source run directly
			// instead of scanning `expRuns` (scoped to this experiment).
			const latestPaper = await getLatestPaperSession(desk.id);
			let paperSession: PaperSessionContext | null = null;
			if (latestPaper) {
				const [sourceRun] = await db
					.select({ runNumber: runs.runNumber })
					.from(runs)
					.where(eq(runs.id, latestPaper.runId));
				paperSession = {
					status: latestPaper.status as "pending" | "running" | "stopped" | "failed",
					runNumber: sourceRun?.runNumber ?? null,
					startedAt: latestPaper.startedAt.toISOString(),
					stoppedAt: latestPaper.stoppedAt?.toISOString() ?? null,
					error: latestPaper.error ?? null,
				};
			}

			// 4. Clear previous log and notify UI that agent is thinking
			clearAgentLog(experimentId);
			const ts = () => new Date().toISOString();

			publishExperimentEvent({
				experimentId,
				type: "agent.thinking",
				payload: { agentRole: session.agentRole },
			});

			// 5. Get adapter and build streaming spawn.
			const adapter = getAgentAdapter(session.adapterType);

			const mcpConfigPath = buildMcpConfigForTurn(experimentId, desk.id);
			// Sandbox the CLI's file tools to the desk workspace so it cannot
			// read the QuantDesk server's own source/doc tree even with
			// absolute paths. Adapter ignores it when not supported.
			const settingsPath =
				adapter.name === "claude" && desk.workspacePath
					? buildClaudeSettingsForTurn(desk.workspacePath)
					: undefined;
			// Phase 27d — track whether the agent invoked any MCP tool during
			// this turn. Replaces the old "any marker present in resultText"
			// heuristic the dead-end guard used. Any tool_call chunk counts;
			// the guard only cares that the agent took a concrete action.
			let didCallTool = false;

			const streamingSpawn = (args: string[], stdin: string) =>
				spawnCli(args, stdin, {
					cwd: desk.workspacePath ?? undefined,
					experimentId,
					onLine: (line) => {
						const chunk = adapter.parseStreamLine(line);
						if (chunk) {
							if (chunk.type === "tool_call") {
								didCallTool = true;
							}
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
							appendAgentLog(
								experimentId,
								{
									ts: ts(),
									...chunk,
								},
								{ role: session.agentRole },
							);

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
			const validationRun =
				role === "risk_manager"
					? ((options.validationRunId
							? expRuns.find((run) => run.id === options.validationRunId)
							: undefined) ?? [...expRuns].sort((a, b) => b.runNumber - a.runNumber)[0])
					: undefined;
			const validationRunResult = validationRun?.result as {
				metrics: {
					key: string;
					label: string;
					value: number;
					format: string;
					tone?: string;
				}[];
			} | null;
			// Root cause: RM turns were launched without the selected run's
			// metrics, so the runner fell back to the analyst prompt instead of
			// a validation prompt for the requested run.
			if (
				role === "risk_manager" &&
				(!validationRunResult || !Array.isArray(validationRunResult.metrics))
			) {
				throw new Error("Risk Manager triggered without a valid run to validate.");
			}

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
				paperSession,
				sessionId: session.sessionId ?? undefined,
				agentRole: session.agentRole as "analyst" | "risk_manager",
				runResult: validationRunResult ?? undefined,
				validationRunNumber: validationRun?.runNumber,
				mcpConfigPath: mcpConfigPath ?? undefined,
				settingsPath,
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
			if (desk.workspacePath) {
				try {
					const changed = await hasChanges(desk.workspacePath);
					if (changed) {
						const ts = new Date().toISOString().replace("T", " ").slice(0, 16);
						await commitCode(
							desk.workspacePath,
							`Agent: Experiment #${experiment.number} — ${experiment.title} (${ts})`,
						);
					}
				} catch {
					/* workspace commit failed, non-fatal */
				}
			}

			// Phase 27d — all legacy marker dispatch (RUN_BACKTEST, BACKTEST_RESULT,
			// DATASET, EXPERIMENT_TITLE, DATA_FETCH, VALIDATION, NEW_EXPERIMENT,
			// COMPLETE_EXPERIMENT, RM_APPROVE/REJECT) has moved into MCP tool
			// handlers in `server/src/mcp/server.ts`. The agent calls those tools
			// during its turn and reacts to structured return values on the same
			// turn. See `doc/agent/MCP.md` for the tool contract.

			// 9. Post agent response as comment (strip legacy markers defensively).
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
			if (result.resultText) {
				const cleanText = stripAgentMarkers(result.resultText);
				if (cleanText) {
					// Phase 27 — scan for side-effects produced during this turn
					// and attach them to the comment metadata so the UI can
					// render clickable chips (dataset preview, run detail)
					// without extra round-trips. Uses turn.startedAt as a lower
					// bound because desk_datasets has no turn_id column.
					const linkedThisTurn = await db
						.select({ datasetId: datasets.id })
						.from(deskDatasets)
						.innerJoin(datasets, eq(deskDatasets.datasetId, datasets.id))
						.where(
							and(eq(deskDatasets.deskId, desk.id), gte(deskDatasets.createdAt, turn!.startedAt)),
						);
					const runsThisTurn = await db
						.select({ id: runs.id, runNumber: runs.runNumber })
						.from(runs)
						.where(eq(runs.turnId, turnId));
					const toolEffects: Record<string, unknown> = {};
					if (linkedThisTurn.length > 0) {
						toolEffects.registeredDatasetIds = linkedThisTurn.map((r) => r.datasetId);
					}
					if (runsThisTurn.length > 0) {
						toolEffects.runIds = runsThisTurn.map((r) => r.id);
					}
					await createComment({
						experimentId,
						author: session.agentRole,
						content: cleanText,
						metadata: Object.keys(toolEffects).length > 0 ? toolEffects : undefined,
					});
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

			// 9c. Dead-end guard. Phase 27d — "had action" is driven by
			// whether the agent invoked any MCP tool during the turn
			// (`didCallTool` tracked from streaming tool_call chunks). If no
			// tool call AND the response is a bare acknowledgment, the
			// guard posts a forcing system comment and retriggers.
			const [currentTurnBeforeRescue] = await db
				.select({ status: agentTurns.status })
				.from(agentTurns)
				.where(eq(agentTurns.id, turnId))
				.limit(1);
			// Root cause: dead-end rescue only trusted streamed tool-call
			// chunks. When `request_validation` did not surface as a parsed
			// chunk, the analyst was retriggered even though the turn had
			// already transitioned into `awaiting_validation`.
			const shouldRescue =
				currentTurnBeforeRescue?.status === "awaiting_validation"
					? false
					: await maybeRescueDeadEnd({
							experimentId,
							resultText: result.resultText,
							hadMarker: didCallTool,
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
					content: `Agent turn failed: ${turnFailureReason}. Reply with a new instruction to continue.`,
				});
				publishExperimentEvent({ experimentId, type: "comment.new", payload: {} });
			} catch (commentErr) {
				console.error("Failed to post failure system comment:", commentErr);
			}
			throw err;
		} finally {
			// Check if the MCP handler already set awaiting_validation
			// (request_validation was called during this turn). If so,
			// preserve that status — the RM verdict handler will transition
			// it to completed later.
			const [currentTurn] = await db
				.select({ status: agentTurns.status })
				.from(agentTurns)
				.where(eq(agentTurns.id, turnId))
				.catch(() => [{ status: "completed" as const }]);
			const finalStatus =
				currentTurn?.status === "awaiting_validation" && turnStatus === "completed"
					? "awaiting_validation"
					: turnStatus;

			await db
				.update(agentTurns)
				.set({
					status: finalStatus,
					endedAt: finalStatus === "awaiting_validation" ? null : new Date(),
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
					status: finalStatus,
					failureReason: turnFailureReason,
					agentRole: session.agentRole,
				},
			});
		}
	});
}
