import { formatAgentMarkersForDisplay } from "@quantdesk/shared";
import {
	Bot,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Code2,
	Database,
	Loader2,
	MessageSquare,
	Send,
	Shield,
	User,
	XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useLiveUpdates } from "../context/LiveUpdatesContext.js";
import type { Comment, Dataset, Experiment } from "../lib/api.js";
import { getAgentLogs, listComments, listDatasets, postComment } from "../lib/api.js";
import { cn } from "../lib/utils.js";
import { listExperimentTurns } from "../lib/api.js";
import { DatasetPreviewModal } from "./DatasetView.js";
import { TurnCard, type TurnLifecycleStatus } from "./TurnCard.js";
import type { TranscriptEntry } from "./transcript/RunTranscriptView.js";
import { RunTranscriptView } from "./transcript/RunTranscriptView.js";
import { Button } from "./ui/button.js";
import { Input } from "./ui/input.js";
import { Separator } from "./ui/separator.js";

interface Props {
	experiment: Experiment;
	onOpenRun?: () => void;
	onOpenTurn?: (turnId: string) => void;
	onNewExperiment?: (newExperiment: Experiment) => void;
	onExperimentUpdated?: () => void;
}

const authorConfig: Record<string, { icon: typeof User; color: string; label: string }> = {
	user: { icon: User, color: "text-blue-400", label: "You" },
	analyst: { icon: Bot, color: "text-green-400", label: "Analyst" },
	risk_manager: { icon: Shield, color: "text-orange-400", label: "Risk Manager" },
	system: { icon: Bot, color: "text-muted-foreground", label: "System" },
};

function CollapsibleCode({ lang, children }: { lang: string; children: ReactNode }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="my-2 rounded-md border border-border overflow-hidden">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="flex items-center gap-1.5 w-full px-3 py-1.5 bg-muted/70 hover:bg-muted text-xs text-muted-foreground transition-colors"
			>
				<ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
				<Code2 className="size-3" />
				<span>{lang || "code"}</span>
			</button>
			{open && (
				<pre className="overflow-x-auto p-3 text-xs bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-200">
					<code>{children}</code>
				</pre>
			)}
		</div>
	);
}

const markdownComponents = {
	pre({ children }: { children?: ReactNode }) {
		return <>{children}</>;
	},
	code({
		className,
		children,
		...props
	}: { className?: string; children?: ReactNode; node?: unknown }) {
		const match = /language-(\w+)/.exec(className ?? "");
		if (match) {
			return <CollapsibleCode lang={match[1]!}>{children}</CollapsibleCode>;
		}
		return (
			<code className="bg-muted px-1 py-0.5 rounded text-[12px]" {...props}>
				{children}
			</code>
		);
	},
};

// Strip [user]/[analyst]/[system]/[risk_manager] prefixes the agent may echo.
// This is post-processing of agent output, not marker handling — kept here.
const AUTHOR_PREFIX_RE = /^\[(user|analyst|system|risk_manager)\]\s*/gm;
function stripAuthorPrefixes(text: string): string {
	return text.replace(AUTHOR_PREFIX_RE, "");
}

function AgentTranscriptToggle({ experimentId }: { experimentId: string }) {
	const [open, setOpen] = useState(false);
	const [entries, setEntries] = useState<TranscriptEntry[] | null>(null);

	const handleToggle = () => {
		if (!open && entries === null) {
			getAgentLogs(experimentId)
				.then((logs) => {
					// Drop `text` entries — those are the assistant's final
					// message, which is already rendered as the nested comment
					// right above the transcript toggle. Keeping them shows the
					// same paragraph twice. The transcript is most useful for
					// tool calls / thinking / result blocks, which are NOT in
					// the comment body.
					const filtered = (logs as unknown as TranscriptEntry[]).filter(
						(e) => (e as { type?: string }).type !== "text",
					);
					setEntries(filtered);
				})
				.catch(() => setEntries([]));
		}
		setOpen((v) => !v);
	};

	return (
		<div className="mt-2">
			<button
				type="button"
				onClick={handleToggle}
				className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
			>
				{open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
				<span>View agent transcript</span>
			</button>
			{open && entries && entries.length > 0 && (
				<div className="mt-1.5 max-h-[400px] overflow-y-auto rounded-md border border-border/50 bg-muted/20 px-2.5 py-1.5">
					<RunTranscriptView entries={entries} density="compact" streaming={false} />
				</div>
			)}
			{open && entries && entries.length === 0 && (
				<div className="mt-2 text-[11px] text-muted-foreground">No transcript available.</div>
			)}
		</div>
	);
}

export function CommentThread({
	experiment,
	onOpenRun,
	onOpenTurn,
	onExperimentUpdated,
}: Props) {
	const [comments, setComments] = useState<Comment[]>([]);
	const [input, setInput] = useState("");
	const [sending, setSending] = useState(false);
	const [thinkingRole, setThinkingRole] = useState<string | null>(null);
	const [streamEntries, setStreamEntries] = useState<TranscriptEntry[]>([]);
	const [runStartedAt, setRunStartedAt] = useState<Date | null>(null);
	// Phase 27 — the TurnCard stays mounted after the agent finishes so the
	// user can always see the terminal state (completed / failed / stopped).
	// Only a new turn (next `agent.thinking` / `turn.status=running`) or an
	// explicit user send resets it.
	const [turnStatus, setTurnStatus] = useState<TurnLifecycleStatus | null>(null);
	const [turnFailureReason, setTurnFailureReason] = useState<string | null>(null);
	const [currentTurnId, setCurrentTurnId] = useState<string | null>(null);
	// Phase 27 step 8 — live docker log tail from the engine container for
	// the run currently running inside the active turn. Capped at 200 lines.
	// Phase 27 — when a turn reaches `completed` we fade the card out and
	// then clear state. failed/stopped stay visible because the user must
	// act on them. Any new turn (`running`) cancels the fade.
	const [fadingOut, setFadingOut] = useState(false);
	// Live tail of `data_fetch.progress` events from the server. Cleared
	// whenever the comment thread refreshes (the next system comment —
	// "Downloaded …" or failure — supersedes the live tail).
	const bottomRef = useRef<HTMLDivElement>(null);

	// Phase 27 — dataset index keyed by id so comment-attached
	// registeredDatasetIds can render clickable preview chips without a
	// per-chip fetch. Reloaded whenever a new comment arrives (the
	// register_dataset tool may have run in between).
	const [datasetsById, setDatasetsById] = useState<Record<string, Dataset>>({});
	const [previewDataset, setPreviewDataset] = useState<Dataset | null>(null);
	useEffect(() => {
		listDatasets(experiment.deskId)
			.then((list) => {
				const map: Record<string, Dataset> = {};
				for (const d of list) map[d.id] = d;
				setDatasetsById(map);
			})
			.catch(() => {});
	}, [experiment.deskId, comments.length]);

	const refresh = useCallback(() => {
		listComments(experiment.id)
			.then((data) => {
				setComments(
					data.filter(
						(c) => !(c.metadata && (c.metadata as { hidden?: boolean }).hidden),
					),
				);
				// Show thinking if agent response is expected:
				// - only 1 comment (desk just created, agent trigger in progress)
				// - last comment is from user (waiting for agent reply)
				const last = data[data.length - 1];
				if (last && (data.length === 1 || last.author === "user")) {
					// Check persisted logs first — if the agent already produced a `result`
					// entry, the run is finished even though no comment was posted
					// (e.g. interrupted by server restart). In that case don't mark
					// the agent as thinking.
					getAgentLogs(experiment.id)
						.then((logs) => {
							const hasResult = logs.some((l) => (l as { type?: string }).type === "result");
							if (hasResult) {
								// Run already finished — don't show streaming widget
								setThinkingRole(null);
								setStreamEntries([]);
								setRunStartedAt(null);
							} else {
								setThinkingRole("analyst");
								if (logs.length > 0) {
									setStreamEntries(logs as unknown as TranscriptEntry[]);
									setRunStartedAt((prev) => prev ?? new Date(logs[0]!.ts));
								}
							}
						})
						.catch(() => {
							setThinkingRole("analyst");
						});
				}
				// Phase 27 — hydrate the TurnCard from the latest agent_turns
				// row so a mid-turn reload (or revisit after the turn finished)
				// restores the same card the user saw before refresh instead
				// of vanishing because turnStatus lived only in React state.
				// This is ALSO the authoritative source for whether the agent
				// is currently busy: if the latest turn is terminal, we must
				// clear any thinkingRole left over by the comment-count
				// heuristic above, otherwise the composer stays locked on
				// "Agent is working..." forever (e.g. a silent mock turn that
				// exited with no output and therefore no comment).
				listExperimentTurns(experiment.id)
					.then((turns) => {
						const latest = turns[turns.length - 1];
						if (!latest) {
							setTurnStatus(null);
							setCurrentTurnId(null);
							setTurnFailureReason(null);
							setThinkingRole(null);
							setRunStartedAt(null);
							return;
						}
						setCurrentTurnId(latest.id);
						setTurnStatus(latest.status);
						setTurnFailureReason(latest.failureReason ?? null);
						if (latest.status === "running") {
							setThinkingRole(latest.agentRole);
							setRunStartedAt((prev) => prev ?? new Date(latest.startedAt));
							// Hydrate streamEntries from the persisted agent log
							// so a refresh or navigate-away-and-back shows the
							// transcript the user had before, instead of a blank
							// card stuck on "Agent is working...".
							getAgentLogs(experiment.id)
								.then((logs) => {
									if (logs.length > 0) {
										setStreamEntries(logs as unknown as TranscriptEntry[]);
									}
								})
								.catch(() => {});
						} else {
							// Terminal — wipe anything the heuristic set so
							// the composer re-enables.
							setThinkingRole(null);
							setRunStartedAt(null);
						}
					})
					.catch(() => {});
				setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "auto" }), 50);
			})
			.catch(() => {});
	}, [experiment.id]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	// Scroll to bottom whenever the message list grows. Covers two cases the
	// inline `setTimeout` inside `refresh` cannot reliably cover:
	// (1) hard page refresh — comments arrive after mount and the cards may
	//     not be laid out yet when refresh's 50ms timer fires; this effect
	//     waits for the actual DOM update.
	// (2) live WS updates that mutate `comments` outside of refresh.
	useEffect(() => {
		if (comments.length === 0) return;
		bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
	}, [comments.length]);

	// Also scroll when the live TurnCard appears/grows (streamed tokens,
	// engine log tail, data-fetch progress, or turn status transitions).
	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
	}, [turnStatus, streamEntries.length]);

	// Fade-out-and-clear on completed — BUT only when nothing else is still
	// happening. A completed agent turn often kicks off a downstream server
	// operation (data fetch, backtest) whose progress the user needs to see.
	// We consider the work "truly done" when:
	//   - turnStatus === "completed", AND
	//   - no live data-fetch tail, AND
	//   - no live engine log tail.
	// failed / stopped stay visible regardless so the user can react.
	useEffect(() => {
		if (turnStatus !== "completed") {
			setFadingOut(false);
			return;
		}
		const holdId = setTimeout(() => setFadingOut(true), 900);
		const clearId = setTimeout(() => {
			setTurnStatus(null);
			setCurrentTurnId(null);
			setStreamEntries([]);
			setRunStartedAt(null);
			setFadingOut(false);
		}, 1400);
		return () => {
			clearTimeout(holdId);
			clearTimeout(clearId);
		};
	}, [turnStatus, comments]);

	// Auto-refresh on WebSocket events
	useLiveUpdates(experiment.id, (event) => {
		if (event.type === "agent.thinking") {
			const role = (event.payload as { agentRole?: string }).agentRole ?? "analyst";
			setThinkingRole(role);
			setStreamEntries([]);
			setRunStartedAt(new Date());
			setTurnStatus("running");
			setTurnFailureReason(null);
			setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 0);
		}
		if (event.type === "run.log_chunk") {
			const payload = event.payload as { line?: string; runId?: string };
			if (payload.line) {
				// Inject the docker line as a `stdout` transcript entry so it
				// appears INSIDE the transcript timeline, right after the
				// run_backtest tool_call that triggered it. The transcript
				// normalizer merges consecutive stdout entries into one block
				// automatically, so the running container tail accumulates in
				// place and a fresh run_backtest tool_call between two bursts
				// visibly separates them.
				setStreamEntries((prev) => [
					...prev,
					{
						type: "stdout",
						content: `${payload.line}\n`,
					} as TranscriptEntry,
				]);
			}
		}
		if (event.type === "turn.status") {
			const payload = event.payload as {
				turnId?: string;
				status?: TurnLifecycleStatus;
				failureReason?: string | null;
			};
			// Out-of-order protection: ignore late events targeting a
			// turn that is NOT the one we are currently tracking. The
			// retrigger chain can produce interleaved events from
			// Turn A (terminal) and Turn B (starting) and a stale
			// "running" or "completed" event from the wrong turn will
			// leave the UI stuck. If a NEW turn starts we accept that
			// as a legitimate new current turn — but only when the
			// previous turn is already terminal, which means the new
			// turn is genuinely live work and not a late echo.
			if (
				payload.turnId &&
				currentTurnId &&
				payload.turnId !== currentTurnId &&
				payload.status !== "running"
			) {
				// Stale terminal event for a past turn — ignore.
				return;
			}
			if (payload.turnId) setCurrentTurnId(payload.turnId);
			if (payload.status) {
				setTurnStatus(payload.status);
				if (payload.status !== "running") {
					setTurnFailureReason(payload.failureReason ?? null);
					// Clear the thinking flag so the comment input re-enables.
					// `agent.done` is supposed to do this too, but the two
					// events race and if turn.status arrives first the input
					// stays locked on "Agent is working..." even though the
					// card is already showing "completed".
					setThinkingRole(null);
					setRunStartedAt(null);
				}
			}
		}
		if (event.type === "data_fetch.progress") {
			const payload = event.payload as { line?: string };
			if (payload.line) {
				// Inject as a stdout transcript entry so the data-fetch tail
				// shows inline under the data_fetch tool_call in the
				// transcript timeline — same treatment as run_backtest logs.
				setStreamEntries((prev) => [
					...prev,
					{ type: "stdout", content: `${payload.line}\n` } as TranscriptEntry,
				]);
			}
			setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 0);
		}
		if (event.type === "agent.streaming") {
			const payload = event.payload as { chunk?: TranscriptEntry };
			const chunk = payload.chunk;
			if (chunk) {
				setStreamEntries((prev) => {
					// For text entries, replace the last text (Claude sends full text, not deltas)
					if (chunk.type === "text") {
						const last = prev[prev.length - 1];
						if (last?.type === "text") {
							return [...prev.slice(0, -1), chunk];
						}
					}
					return [...prev, chunk];
				});
			}
			setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 0);
		}
		if (event.type === "agent.done") {
			// Phase 27 — do NOT clear the card on done. The turn.status event
			// (or this path when no explicit terminal came through) flips the
			// card into a terminal visual state, but it stays mounted so the
			// user can see "the agent finished" rather than watch the widget
			// vanish and wonder if it died.
			setThinkingRole(null);
			setRunStartedAt(null);
			setTurnStatus((prev) => (prev && prev !== "running" ? prev : "completed"));
			refresh();
		}
		if (event.type === "comment.new") {
			refresh();
		}
		if (event.type === "experiment.updated") {
			onExperimentUpdated?.();
		}
	});

	const handleSend = async () => {
		if (!input.trim() || sending) return;
		setSending(true);
		try {
			await postComment(experiment.id, input.trim());
			setInput("");
			refresh();
			setThinkingRole("analyst");
			setStreamEntries([]);
			setRunStartedAt(new Date());
			setTurnStatus("running");
			setTurnFailureReason(null);
		} finally {
			setSending(false);
		}
	};

	return (
		<div className="flex flex-col h-full">
			{/* Header */}
			<div className="px-4 h-12 flex items-center gap-2 shrink-0">
				<span className="text-[13px] font-semibold">Experiment #{experiment.number}</span>
				<span className="text-[13px] text-muted-foreground">— {experiment.title}</span>
			</div>
			<Separator />

			{/* Messages */}
			<div className="flex-1 overflow-y-auto pl-4 pr-6 py-4 space-y-3">
				{(() => {
					// Resolve each comment's effective turnId: a comment's own
					// turnId if set, otherwise its parent's (recursively).
					// System comments posted during data-fetch / downstream
					// work often have no turnId but link back via
					// `parentCommentId`, and we want them to land in the same
					// turn-card timeline as the agent comment that triggered
					// them.
					const commentById = new Map<string, Comment>();
					for (const c of comments) commentById.set(c.id, c);
					const resolveTurnId = (c: Comment): string | null => {
						if (c.turnId) return c.turnId;
						let cursor: Comment | undefined = c;
						const seen = new Set<string>();
						while (cursor) {
							if (cursor.turnId) return cursor.turnId;
							if (seen.has(cursor.id)) break;
							seen.add(cursor.id);
							const parentId = (
								cursor.metadata as { parentCommentId?: string } | null
							)?.parentCommentId;
							if (!parentId) break;
							cursor = commentById.get(parentId);
						}
						return null;
					};
					// Parent/child nesting is still honoured for legacy
					// top-level comments (the ones that never make it into a
					// turn group), so replies can remain threaded outside a
					// turn card.
					const childrenByParent = new Map<string, Comment[]>();
					for (const c of comments) {
						if (resolveTurnId(c)) continue; // will be flattened into its turn
						const parentId = (c.metadata as { parentCommentId?: string } | null)?.parentCommentId;
						if (parentId) {
							const arr = childrenByParent.get(parentId) ?? [];
							arr.push(c);
							childrenByParent.set(parentId, arr);
						}
					}
					const usedAsChild = new Set<string>();
					for (const arr of childrenByParent.values()) {
						for (const c of arr) usedAsChild.add(c.id);
					}
					type TopItem =
						| { kind: "comment"; comment: Comment }
						| { kind: "turn"; turnId: string; comments: Comment[] };
					const topItems: TopItem[] = [];
					const turnIndex = new Map<string, number>();
					for (const c of comments) {
						if (usedAsChild.has(c.id)) continue;
						const effectiveTurnId = resolveTurnId(c);
						if (
							!effectiveTurnId &&
							(c.metadata as { parentCommentId?: string } | null)?.parentCommentId
						) {
							continue;
						}
						if (c.author === "user") {
							topItems.push({ kind: "comment", comment: c });
							continue;
						}
						if (effectiveTurnId) {
							const idx = turnIndex.get(effectiveTurnId);
							if (idx === undefined) {
								turnIndex.set(effectiveTurnId, topItems.length);
								topItems.push({
									kind: "turn",
									turnId: effectiveTurnId,
									comments: [c],
								});
							} else {
								(topItems[idx] as { comments: Comment[] }).comments.push(c);
							}
							continue;
						}
						// Legacy: no turnId. Render as a top-level comment.
						topItems.push({ kind: "comment", comment: c });
					}
					// Merge consecutive turn groups of the same agent role
					// when no user comment separates them — e.g. a failed
					// Analyst turn followed by a retrigger from the same
					// role should read as one continuous card.
					const turnRole = (cs: Comment[]) =>
						cs.find((c) => c.author === "risk_manager") ? "risk_manager" : "analyst";
					const mergedTopItems: TopItem[] = [];
					for (const it of topItems) {
						const prev = mergedTopItems[mergedTopItems.length - 1];
						if (
							it.kind === "turn" &&
							prev &&
							prev.kind === "turn" &&
							turnRole(prev.comments) === turnRole(it.comments)
						) {
							prev.comments.push(...it.comments);
							continue;
						}
						mergedTopItems.push(it);
					}
					// Choose a timeline icon for a nested comment based on author
					// and content heuristics — analyst gets the bot, risk
					// manager the shield, and system messages are categorized
					// into success / failure / in-progress / info by keywords.
					// This is purely cosmetic until we wire real tool_call /
					// tool_result events from the server.
					const pickTimelineIcon = (
						c: Comment,
					): { Icon: typeof User; tone: string; bg: string; spin?: boolean } => {
						if (c.author === "analyst") {
							return {
								Icon: Bot,
								tone: "text-purple-700 dark:text-purple-300",
								bg: "bg-purple-100 dark:bg-purple-900/40",
							};
						}
						if (c.author === "risk_manager") {
							return {
								Icon: Shield,
								tone: "text-orange-700 dark:text-orange-300",
								bg: "bg-orange-100 dark:bg-orange-900/40",
							};
						}
						if (c.author === "user") {
							return {
								Icon: User,
								tone: "text-blue-600 dark:text-blue-300",
								bg: "bg-blue-100 dark:bg-blue-900/40",
							};
						}
						// system
						const text = c.content.toLowerCase();
						if (/failed|error|exception|cannot/.test(text)) {
							return {
								Icon: XCircle,
								tone: "text-red-700 dark:text-red-300",
								bg: "bg-red-100 dark:bg-red-900/40",
							};
						}
						if (/downloaded|successfully|completed|finished|approved/.test(text)) {
							return {
								Icon: CheckCircle2,
								tone: "text-green-700 dark:text-green-300",
								bg: "bg-green-100 dark:bg-green-900/40",
							};
						}
						if (/downloading|loading|fetching|running|in progress/.test(text)) {
							return {
								Icon: Database,
								tone: "text-cyan-700 dark:text-cyan-300",
								bg: "bg-cyan-100 dark:bg-cyan-900/40",
								spin: true,
							};
						}
						return {
							Icon: MessageSquare,
							tone: "text-muted-foreground",
							bg: "bg-muted",
						};
					};

					const renderComment = (
						c: Comment,
						isChild = false,
						inTurnCard = false,
					): ReactNode => {
						const config = authorConfig[c.author] ?? authorConfig.system!;
						const Icon = config.icon;
						const cleanContent = stripAuthorPrefixes(c.content).trim();
						const children = childrenByParent.get(c.id) ?? [];

						// Timeline mode: render as a row in the turn card's
						// vertical timeline (icon column + content). The icon
						// sits on top of the parent container's left border so
						// the rows look like nodes on a thread.
						if (inTurnCard) {
							const tl = pickTimelineIcon(c);
							const TLIcon = tl.Icon;
							return (
								<div key={c.id} className="relative pl-8 pb-5 last:pb-0">
									<div
										className={cn(
											"absolute left-0 top-0 z-10 flex size-6 items-center justify-center rounded-full",
											tl.bg,
										)}
									>
										<TLIcon
											className={cn("size-3", tl.tone, tl.spin && "animate-pulse")}
										/>
									</div>
									{cleanContent && (
										<div className="text-[13px] text-foreground leading-relaxed prose prose-sm prose-neutral dark:prose-invert max-w-none prose-strong:text-foreground prose-p:my-0 prose-ul:my-1 prose-li:my-0 prose-headings:my-1 prose-pre:my-1">
											<Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
												{formatAgentMarkersForDisplay(cleanContent)}
											</Markdown>
										</div>
									)}
									{(() => {
										// Phase 27 — dataset side-effect chips.
										// register_dataset tool calls get attached to the
										// comment's metadata by agent-trigger so we can
										// render clickable preview pills without needing
										// a per-chip roundtrip.
										const regIds = ((c.metadata as { registeredDatasetIds?: unknown } | null)
											?.registeredDatasetIds ?? []) as string[];
										if (regIds.length === 0) return null;
										return (
											<div className="mt-2 flex flex-wrap gap-1.5">
												{regIds.map((id) => {
													const d = datasetsById[id];
													if (!d) return null;
													return (
														<button
															key={id}
															type="button"
															onClick={() => setPreviewDataset(d)}
															className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-1 text-[11px] font-medium text-foreground/80 hover:bg-muted hover:text-foreground transition-colors"
														>
															<Database className="size-3 text-cyan-600 dark:text-cyan-300" />
															<span className="font-mono">{d.pairs.join(", ")} · {d.timeframe}</span>
															<span className="text-foreground/40">{d.exchange}</span>
														</button>
													);
												})}
											</div>
										);
									})()}
									{/* In turn-card timeline mode, `children` is always
									    empty (the builder flattens everything into the
									    turn group as siblings), so we intentionally skip
									    recursive child rendering here. */}
								</div>
							);
						}

						const isUser = c.author === "user";
						return (
							<div
								key={c.id}
								className={cn(
									isChild && "ml-6 mt-2",
									!isChild && isUser && "flex justify-end",
								)}
							>
								<div
									className={cn(
										"rounded-md border p-3",
										isUser && !isChild
											? "max-w-[75%] border-blue-500/30 bg-blue-500/[0.06]"
											: "border-border",
									)}
								>
									{/* Author header row */}
									<div className="flex items-center gap-2 mb-1.5">
										<div
											className={cn(
												"size-6 rounded-full flex items-center justify-center shrink-0",
												c.author === "user" ? "bg-blue-500/15" : "bg-muted",
											)}
										>
											<Icon className={cn("size-3", config.color)} />
										</div>
										<span className={cn("text-xs font-medium", config.color)}>
											{config.label}
										</span>
										<span className="text-xs text-muted-foreground ml-auto">
											{new Date(c.createdAt).toLocaleTimeString([], {
												hour: "2-digit",
												minute: "2-digit",
											})}
										</span>
									</div>
									{cleanContent && (
										<div className="text-[13px] text-foreground leading-relaxed prose prose-sm prose-neutral dark:prose-invert max-w-none prose-strong:text-foreground prose-p:my-3 prose-ul:my-2 prose-li:my-0.5 prose-headings:mt-5 prose-headings:mb-2">
											<Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
												{formatAgentMarkersForDisplay(cleanContent)}
											</Markdown>
										</div>
									)}
									{(c.author === "analyst" || c.author === "risk_manager") && (
										<AgentTranscriptToggle experimentId={experiment.id} />
									)}
								</div>
								{children.map((child) => renderComment(child, true))}
							</div>
						);
					};
					// Render. Live active turn (currentTurnId, status === running)
					// is excluded here — it's drawn as the sticky bottom
					// TurnCard with streaming entries. Past turns get a static
					// TurnCard with their nested comments.
					return mergedTopItems.map((item, idx) => {
						if (item.kind === "comment") {
							return renderComment(item.comment);
						}
						// Skip the running turn here; the sticky bottom TurnCard
						// owns it so streaming chunks land in one place. Once
						// the turn finishes, the inline group takes over and
						// the sticky bottom card unmounts.
						if (item.turnId === currentTurnId && turnStatus === "running") {
							return null;
						}
						// If the previous rendered item is ALSO an agent turn
						// (no user comment between them) we draw a small
						// connector showing the second turn is a direct
						// continuation. Without this, two back-to-back agent
						// cards look like they belong to separate conversations.
						const prev = idx > 0 ? mergedTopItems[idx - 1] : null;
						const showContinuationConnector =
							!!prev &&
							prev.kind === "turn" &&
							!(prev.turnId === currentTurnId && turnStatus === "running");
						// Also skip the persisted active turn if its status is
						// still in React state but already terminal — the
						// previous condition handled running, this handles a
						// transient case where state hasn't cleared yet.
						// Drop the bottom sticky for terminal states; inline
						// owns them.
						const first = item.comments[0]!;
						const role =
							item.comments.find((c) => c.author === "risk_manager")
								? "risk_manager"
								: "analyst";
						// Past-turn cards are always "completed" — approval is
						// conversational now (CLAUDE.md rule #15), so there's
						// no "awaiting_user" state encoded in the comments. If
						// the agent ended with a question, the user just
						// replies in the composer.
						const pastStatus: TurnLifecycleStatus = "completed";
						return (
							<div key={item.turnId}>
								{showContinuationConnector && (
									<div className="flex items-center gap-2 px-4 py-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60">
										<div className="h-px flex-1 bg-border" />
										<span>continued (no user reply)</span>
										<div className="h-px flex-1 bg-border" />
									</div>
								)}
								<TurnCard
									experimentNumber={experiment.number}
									agentRole={role}
									entries={[]}
									status={pastStatus}
									startedAt={new Date(first.createdAt)}
									onStop={() => {}}
									onOpen={onOpenTurn ? () => onOpenTurn(item.turnId) : undefined}
									hasRun
									failureReason={null}
									nestedComments={item.comments.map((c) =>
										renderComment(c, false, true),
									)}
									footer={<AgentTranscriptToggle experimentId={experiment.id} />}
								/>
							</div>
						);
					});
				})()}
				{comments.length === 0 && !thinkingRole && (
					<div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
						No comments yet
					</div>
				)}
				{turnStatus === "running" &&
					!(
						streamEntries.length > 0 ||
						(!!currentTurnId && comments.some((c) => c.turnId === currentTurnId))
					) && (
						// Nothing to render yet — show a small pending shimmer so
						// the user sees the agent is spinning up instead of an
						// empty blank gap between desk creation and the first
						// streamed token.
						<div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground animate-in fade-in duration-300">
							<Loader2 className="size-3.5 animate-spin text-cyan-500" />
							<span>Agent is warming up…</span>
						</div>
					)}
				{turnStatus === "running" &&
					// Don't flash an empty card on brand-new desks: wait until
					// the running turn has SOMETHING to show (streamed tokens,
					// engine/data-fetch progress, or a nested comment attached
					// to this turn). Prevents a phantom TurnCard from briefly
					// appearing between desk creation and the first agent
					// output.
					(streamEntries.length > 0 ||
						(!!currentTurnId &&
							comments.some((c) => c.turnId === currentTurnId))) && (
					<div
						className={cn(
							"transition-all duration-500 ease-out",
							fadingOut
								? "opacity-0 translate-y-8 scale-90 max-h-0 overflow-hidden origin-top"
								: "opacity-100 translate-y-0 scale-100 animate-in fade-in slide-in-from-bottom-2 duration-300",
						)}
					>
						{(() => {
							// Show the "continued (no user reply)" separator above
							// the live running card when the most recent comment
							// before it is not from the user — i.e. an agent turn
							// just finished and another one started without the
							// user saying anything in between.
							const nonCurrent = comments.filter(
								(c) => !currentTurnId || c.turnId !== currentTurnId,
							);
							const lastPrior = nonCurrent[nonCurrent.length - 1];
							const showConnector = !!lastPrior && lastPrior.author !== "user";
							return showConnector ? (
								<div className="flex items-center gap-2 px-4 py-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60">
									<div className="h-px flex-1 bg-border" />
									<span>continued (no user reply)</span>
									<div className="h-px flex-1 bg-border" />
								</div>
							) : null;
						})()}
						<TurnCard
							experimentNumber={experiment.number}
							agentRole={thinkingRole ?? "analyst"}
							entries={streamEntries}
							status={turnStatus}
							startedAt={runStartedAt ?? undefined}
							failureReason={turnFailureReason}
							onStop={async () => {
								await fetch(`/api/experiments/${experiment.id}/agent/stop`, {
									method: "POST",
								});
								setThinkingRole(null);
								setTurnStatus("stopped");
							}}
							onOpen={
								currentTurnId && onOpenTurn ? () => onOpenTurn(currentTurnId) : onOpenRun
							}
							hasRun={!!currentTurnId}
						/>
					</div>
				)}
				<div ref={bottomRef} />
			</div>

			{/* Input */}
			<Separator />
			<div className="px-4 py-3">
				<div className="flex gap-2">
					<Input
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && !thinkingRole && handleSend()}
						placeholder={thinkingRole ? "Agent is working..." : "Type a comment..."}
						disabled={!!thinkingRole}
					/>
					<Button
						size="sm"
						onClick={handleSend}
						disabled={sending || !input.trim() || !!thinkingRole}
					>
						<Send className="size-4" />
					</Button>
				</div>
			</div>
			{previewDataset && (
				<DatasetPreviewModal
					dataset={previewDataset}
					deskId={experiment.deskId}
					onClose={() => setPreviewDataset(null)}
				/>
			)}
		</div>
	);
}
