import { Bot, Send, Shield, User } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
	analytics: { icon: Bot, color: "text-green-400", label: "Analytics" },
	risk_manager: { icon: Shield, color: "text-orange-400", label: "Risk Manager" },
	system: { icon: Bot, color: "text-muted-foreground", label: "System" },
};

export function CommentThread({ experiment }: Props) {
	const [comments, setComments] = useState<Comment[]>([]);
	const [input, setInput] = useState("");
	const [sending, setSending] = useState(false);
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

	const handleSend = async () => {
		if (!input.trim() || sending) return;
		setSending(true);
		try {
			await postComment(experiment.id, input.trim());
			setInput("");
			refresh();
		} finally {
			setSending(false);
		}
	};

	return (
		<div className="flex flex-col h-full">
			{/* Header */}
			<div className="px-4 h-12 flex items-center gap-2 shrink-0">
				<span className="text-sm font-semibold">Experiment #{experiment.number}</span>
				<span className="text-sm text-muted-foreground">— {experiment.title}</span>
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
							<p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
								{c.content}
							</p>
						</div>
					);
				})}
				{comments.length === 0 && (
					<div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
						No comments yet
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
