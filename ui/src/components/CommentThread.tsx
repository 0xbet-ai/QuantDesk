import {
	Bot,
	CheckCircle2,
	ChevronRight,
	Code2,
	Loader2,
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
import { listComments, postComment } from "../lib/api.js";
import { cn } from "../lib/utils.js";
import { Button } from "./ui/button.js";
import { Input } from "./ui/input.js";
import { Separator } from "./ui/separator.js";

interface Props {
	experiment: Experiment;
}

const authorConfig: Record<string, { icon: typeof User; color: string; label: string }> = {
	user: { icon: User, color: "text-blue-400", label: "You" },
	analyst: { icon: Bot, color: "text-green-400", label: "Analyst" },
	risk_manager: { icon: Shield, color: "text-orange-400", label: "Risk Manager" },
	system: { icon: Bot, color: "text-muted-foreground", label: "System" },
};

function useTypewriter(text: string, charsPerTick = 3) {
	const [displayed, setDisplayed] = useState("");
	const targetRef = useRef(text);
	targetRef.current = text;

	useEffect(() => {
		if (!text) {
			setDisplayed("");
			return;
		}
		// If new text is longer, animate from current position
		const interval = setInterval(() => {
			setDisplayed((prev) => {
				const target = targetRef.current;
				if (prev.length >= target.length) {
					clearInterval(interval);
					return target;
				}
				return target.slice(0, prev.length + charsPerTick);
			});
		}, 16);
		return () => clearInterval(interval);
	}, [text, charsPerTick]);

	return { displayed, isTyping: displayed.length < text.length };
}

function ElapsedTimer() {
	const [elapsed, setElapsed] = useState(0);
	useEffect(() => {
		const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
		return () => clearInterval(interval);
	}, []);
	const mins = Math.floor(elapsed / 60);
	const secs = elapsed % 60;
	return (
		<span className="text-xs text-muted-foreground tabular-nums ml-auto">
			{mins > 0 ? `${mins}m ${secs}s` : `${secs}s`}
		</span>
	);
}

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
		proposals.push({ type, value: value.trim() });
		return "";
	});
	cleanContent = cleanContent.replace(AUTHOR_PREFIX_RE, "");
	return { cleanContent: cleanContent.trim(), proposals };
}

export function CommentThread({ experiment }: Props) {
	const [comments, setComments] = useState<Comment[]>([]);
	const [input, setInput] = useState("");
	const [sending, setSending] = useState(false);
	const [thinkingRole, setThinkingRole] = useState<string | null>(null);
	const [streamingText, setStreamingText] = useState("");
	const { displayed: typedText, isTyping } = useTypewriter(streamingText, 4);
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
				}
				setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 0);
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
			setStreamingText("");
			setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 0);
		}
		if (event.type === "agent.streaming") {
			const text = (event.payload as { text?: string }).text ?? "";
			setStreamingText(text);
			setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 0);
		}
		if (event.type === "agent.done" || event.type === "comment.new") {
			setThinkingRole(null);
			setStreamingText("");
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
			setStreamingText("");
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
			<div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
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
								<div
									key={p.type}
									className="mt-2 flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2"
								>
									<span className="text-xs text-foreground flex-1">
										{proposalLabels[p.type]}
										{p.value && <span className="text-muted-foreground ml-1">— {p.value}</span>}
									</span>
									<Button
										size="sm"
										variant="outline"
										className="h-6 px-2 text-xs gap-1"
										onClick={() => {
											/* TODO: handle approve */
										}}
									>
										<CheckCircle2 className="size-3" />
										Approve
									</Button>
									<Button
										size="sm"
										variant="ghost"
										className="h-6 px-2 text-xs gap-1 text-muted-foreground"
										onClick={() => {
											/* TODO: handle decline */
										}}
									>
										<XCircle className="size-3" />
										Decline
									</Button>
								</div>
							))}
						</div>
					);
				})}
				{comments.length === 0 && !thinkingRole && (
					<div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
						No comments yet
					</div>
				)}
				{thinkingRole && (
					<div className="rounded-md border border-border p-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
						<div className="flex items-center gap-2 mb-1.5">
							<div className="size-6 rounded-full flex items-center justify-center shrink-0 bg-muted">
								{thinkingRole === "risk_manager" ? (
									<Shield className="size-3 text-orange-400" />
								) : (
									<Bot className="size-3 text-green-400" />
								)}
							</div>
							<span
								className={cn(
									"text-xs font-medium",
									thinkingRole === "risk_manager" ? "text-orange-400" : "text-green-400",
								)}
							>
								{thinkingRole === "risk_manager" ? "Risk Manager" : "Analyst"}
							</span>
							<Loader2 className="size-3 animate-spin text-muted-foreground ml-1" />
							<ElapsedTimer />
						</div>
						{typedText ? (
							<div className="text-[13px] text-foreground leading-relaxed prose prose-sm prose-neutral dark:prose-invert max-w-none prose-p:my-3 prose-ul:my-2 prose-li:my-0.5 prose-headings:mt-5 prose-headings:mb-2 prose-strong:text-foreground">
								<Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
									{typedText}
								</Markdown>
								{isTyping && (
									<span className="inline-block w-1.5 h-4 bg-green-400 animate-pulse ml-0.5 align-text-bottom" />
								)}
							</div>
						) : (
							<div className="flex items-center gap-1.5 mt-1">
								<span className="text-xs text-muted-foreground">Thinking…</span>
							</div>
						)}
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
						onKeyDown={(e) => e.key === "Enter" && handleSend()}
						placeholder="Type a comment..."
					/>
					<Button size="sm" onClick={handleSend} disabled={sending || !input.trim()}>
						<Send className="size-4" />
					</Button>
				</div>
			</div>
		</div>
	);
}
