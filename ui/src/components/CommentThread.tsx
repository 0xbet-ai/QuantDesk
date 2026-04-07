import {
	Bot,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Code2,
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
import type { Comment, Experiment } from "../lib/api.js";
import { getAgentLogs, listComments, postComment } from "../lib/api.js";
import { cn } from "../lib/utils.js";
import { LiveRunWidget } from "./LiveRunWidget.js";
import type { TranscriptEntry } from "./transcript/RunTranscriptView.js";
import { RunTranscriptView } from "./transcript/RunTranscriptView.js";
import { Button } from "./ui/button.js";
import { Input } from "./ui/input.js";
import { Separator } from "./ui/separator.js";

interface Props {
	experiment: Experiment;
	onOpenRun?: () => void;
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
				<pre className="overflow-x-auto p-3 text-xs bg-zinc-950 text-zinc-200">
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

interface Proposal {
	type: "VALIDATION" | "NEW_EXPERIMENT" | "COMPLETE_EXPERIMENT" | "GO_LIVE";
	value: string;
}

const proposalLabels: Record<Proposal["type"], string> = {
	VALIDATION: "Run Risk Manager validation",
	NEW_EXPERIMENT: "Create new experiment",
	COMPLETE_EXPERIMENT: "Mark experiment as completed",
	GO_LIVE: "Go live with this run",
};

const PROPOSAL_RE =
	/^\[PROPOSE_(VALIDATION|NEW_EXPERIMENT|COMPLETE_EXPERIMENT|GO_LIVE)\]\s*(?:—\s*)?(.*)$/gm;

// Strip [user]/[analyst]/[system]/[risk_manager] prefixes that the agent may echo
const AUTHOR_PREFIX_RE = /^\[(user|analyst|system|risk_manager)\]\s*/gm;

function parseProposals(content: string): { cleanContent: string; proposals: Proposal[] } {
	const proposals: Proposal[] = [];
	let cleanContent = content.replace(PROPOSAL_RE, (_, type: Proposal["type"], value: string) => {
		// Strip nested [PROPOSE_*] markers from value
		const cleanValue = value
			.trim()
			.replace(/\[PROPOSE_\w+\]/g, "")
			.replace(/—\s*$/, "")
			.trim();
		proposals.push({ type, value: cleanValue });
		return "";
	});
	// Catch any remaining standalone markers not on their own line
	cleanContent = cleanContent.replace(
		/\[PROPOSE_(VALIDATION|NEW_EXPERIMENT|COMPLETE_EXPERIMENT|GO_LIVE)\]/g,
		(_, type: Proposal["type"]) => {
			if (!proposals.some((p) => p.type === type)) {
				proposals.push({ type, value: "" });
			}
			return "";
		},
	);
	cleanContent = cleanContent.replace(AUTHOR_PREFIX_RE, "");
	return { cleanContent: cleanContent.trim(), proposals };
}

function ProposalCard({
	proposal,
	experimentId,
	onAction,
}: { proposal: Proposal; experimentId: string; onAction: () => void }) {
	const [status, setStatus] = useState<"pending" | "approved" | "declined">("pending");

	const handleApprove = async () => {
		setStatus("approved");
		const message = `Approved: ${proposalLabels[proposal.type]}${proposal.value ? ` — ${proposal.value}` : ""}`;
		await postComment(experimentId, message);
		onAction();
	};

	const handleDecline = async () => {
		setStatus("declined");
		const message = `Declined: ${proposalLabels[proposal.type]}`;
		await postComment(experimentId, message);
		onAction();
	};

	return (
		<div className="mt-2 rounded-md border border-border bg-muted/50 px-3 py-2">
			<span className="text-xs text-foreground">
				{proposalLabels[proposal.type]}
				{proposal.value && <span className="text-muted-foreground ml-1">— {proposal.value}</span>}
			</span>
			{status === "pending" ? (
				<div className="flex gap-2 mt-2">
					<Button
						size="sm"
						variant="outline"
						className="h-7 px-3 text-xs gap-1"
						onClick={handleApprove}
					>
						<CheckCircle2 className="size-3" />
						Approve
					</Button>
					<Button
						size="sm"
						variant="ghost"
						className="h-7 px-3 text-xs gap-1 text-muted-foreground"
						onClick={handleDecline}
					>
						<XCircle className="size-3" />
						Decline
					</Button>
				</div>
			) : (
				<div className="mt-1">
					<span
						className={cn(
							"text-xs font-medium",
							status === "approved" ? "text-green-500" : "text-muted-foreground",
						)}
					>
						{status === "approved" ? "Approved" : "Declined"}
					</span>
				</div>
			)}
		</div>
	);
}

function AgentTranscriptToggle({ experimentId }: { experimentId: string }) {
	const [open, setOpen] = useState(false);
	const [entries, setEntries] = useState<TranscriptEntry[] | null>(null);

	const handleToggle = () => {
		if (!open && entries === null) {
			getAgentLogs(experimentId)
				.then((logs) => setEntries(logs as unknown as TranscriptEntry[]))
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
				<div className="mt-2 max-h-[400px] overflow-y-auto rounded-md border border-border/50 bg-muted/20 p-3">
					<RunTranscriptView entries={entries} density="compact" streaming={false} />
				</div>
			)}
			{open && entries && entries.length === 0 && (
				<div className="mt-2 text-[11px] text-muted-foreground">No transcript available.</div>
			)}
		</div>
	);
}

export function CommentThread({ experiment, onOpenRun }: Props) {
	const [comments, setComments] = useState<Comment[]>([]);
	const [input, setInput] = useState("");
	const [sending, setSending] = useState(false);
	const [thinkingRole, setThinkingRole] = useState<string | null>(null);
	const [streamEntries, setStreamEntries] = useState<TranscriptEntry[]>([]);
	const [runStartedAt, setRunStartedAt] = useState<Date | null>(null);
	const bottomRef = useRef<HTMLDivElement>(null);

	const refresh = useCallback(() => {
		listComments(experiment.id)
			.then((data) => {
				setComments(data);
				// Show thinking if agent response is expected:
				// - only 1 comment (desk just created, agent trigger in progress)
				// - last comment is from user (waiting for agent reply)
				const last = data[data.length - 1];
				if (last && (data.length === 1 || last.author === "user")) {
					setThinkingRole("analyst");
					// Restore persisted agent logs
					getAgentLogs(experiment.id)
						.then((logs) => {
							if (logs.length > 0) {
								setStreamEntries(logs as unknown as TranscriptEntry[]);
								setRunStartedAt((prev) => prev ?? new Date(logs[0]!.ts));
							}
						})
						.catch(() => {});
				}
				setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "auto" }), 50);
			})
			.catch(() => {});
	}, [experiment.id]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	// Auto-refresh on WebSocket events
	useLiveUpdates(experiment.id, (event) => {
		if (event.type === "agent.thinking") {
			const role = (event.payload as { agentRole?: string }).agentRole ?? "analyst";
			setThinkingRole(role);
			setStreamEntries([]);
			setRunStartedAt(new Date());
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
			setThinkingRole(null);
			setRunStartedAt(null);
			refresh();
			// Keep streamEntries — they'll show as completed transcript
		}
		if (event.type === "comment.new") {
			refresh();
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
				{comments.map((c) => {
					const config = authorConfig[c.author] ?? authorConfig.system!;
					const Icon = config.icon;
					const { cleanContent, proposals } = parseProposals(c.content);
					return (
						<div key={c.id} className="rounded-md border border-border p-3">
							<div className="flex items-center gap-2 mb-1.5">
								<div
									className={cn(
										"size-6 rounded-full flex items-center justify-center shrink-0",
										c.author === "user" ? "bg-blue-500/15" : "bg-muted",
									)}
								>
									<Icon className={cn("size-3", config.color)} />
								</div>
								<span className={cn("text-xs font-medium", config.color)}>{config.label}</span>
								<span className="text-xs text-muted-foreground ml-auto">
									{new Date(c.createdAt).toLocaleTimeString([], {
										hour: "2-digit",
										minute: "2-digit",
									})}
								</span>
							</div>
							{cleanContent && (
								<div className="text-[13px] text-foreground leading-relaxed prose prose-sm prose-neutral dark:prose-invert max-w-none prose-p:my-3 prose-ul:my-2 prose-li:my-0.5 prose-headings:mt-5 prose-headings:mb-2 prose-strong:text-foreground">
									<Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
										{cleanContent}
									</Markdown>
								</div>
							)}
							{proposals.map((p) => (
								<ProposalCard
									key={p.type}
									proposal={p}
									experimentId={experiment.id}
									onAction={() => {
										refresh();
										setThinkingRole("analyst");
										setStreamEntries([]);
									}}
								/>
							))}
							{(c.author === "analyst" || c.author === "risk_manager") && (
								<AgentTranscriptToggle experimentId={experiment.id} />
							)}
						</div>
					);
				})}
				{comments.length === 0 && !thinkingRole && (
					<div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
						No comments yet
					</div>
				)}
				{(thinkingRole || streamEntries.length > 0) && (
					<div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
						<LiveRunWidget
							experimentNumber={experiment.number}
							agentRole={thinkingRole ?? "analyst"}
							entries={streamEntries}
							streaming={!!thinkingRole}
							startedAt={runStartedAt ?? undefined}
							onStop={async () => {
								await fetch(`/api/experiments/${experiment.id}/agent/stop`, {
									method: "POST",
								});
								setThinkingRole(null);
								setStreamEntries([]);
								setRunStartedAt(null);
							}}
							onOpenRun={onOpenRun}
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
		</div>
	);
}
