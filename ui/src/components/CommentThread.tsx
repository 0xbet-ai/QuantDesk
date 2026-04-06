import { useCallback, useEffect, useRef, useState } from "react";
import type { Comment, Experiment } from "../lib/api.js";
import { listComments, postComment } from "../lib/api.js";

interface Props {
	experiment: Experiment;
}

const authorColors: Record<string, string> = {
	user: "text-blue-400",
	analytics: "text-green-400",
	risk_manager: "text-orange-400",
	system: "text-gray-500",
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
			<div className="px-4 py-2 border-b border-gray-800 text-sm font-medium">
				Experiment #{experiment.number} — {experiment.title}
			</div>

			<div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
				{comments.map((c) => (
					<div key={c.id} className="text-sm">
						<span className={`font-medium ${authorColors[c.author] ?? "text-gray-300"}`}>
							[{c.author}]
						</span>{" "}
						<span className="text-gray-200 whitespace-pre-wrap">{c.content}</span>
					</div>
				))}
				<div ref={bottomRef} />
			</div>

			<div className="px-4 py-3 border-t border-gray-800">
				<div className="flex gap-2">
					<input
						type="text"
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && handleSend()}
						placeholder="Type a comment..."
						className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
					/>
					<button
						type="button"
						onClick={handleSend}
						disabled={sending || !input.trim()}
						className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-sm font-medium"
					>
						Send
					</button>
				</div>
			</div>
		</div>
	);
}
