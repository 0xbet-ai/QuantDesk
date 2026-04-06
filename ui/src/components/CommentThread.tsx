import { Bot, Loader2, Send, Shield, User } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
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

export function CommentThread({ experiment }: Props) {
	const [comments, setComments] = useState<Comment[]>([]);
	const [input, setInput] = useState("");
	const [sending, setSending] = useState(false);
	const [thinkingRole, setThinkingRole] = useState<string | null>(null);
	const [streamingText, setStreamingText] = useState("");
	const bottomRef = useRef<HTMLDivElement>(null);

	const refresh = useCallback(() => {
		listComments(experiment.id)
			.then((data) => {
				setComments(data);
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
							<div className="text-[13px] text-foreground leading-relaxed prose prose-sm prose-neutral dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-headings:my-2 prose-strong:text-foreground">
								<Markdown>{c.content}</Markdown>
							</div>
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
						{streamingText ? (
							<div className="text-[13px] text-foreground leading-relaxed prose prose-sm prose-neutral dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-headings:my-2 prose-strong:text-foreground">
								<Markdown>{streamingText}</Markdown>
								<span className="inline-block w-1.5 h-4 bg-green-400 animate-pulse ml-0.5 align-text-bottom" />
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
