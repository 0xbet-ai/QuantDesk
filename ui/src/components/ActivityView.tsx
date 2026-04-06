import {
	Activity,
	CheckCircle2,
	ChevronRight,
	FlaskConical,
	MessageSquare,
	Play,
	Radio,
	Square,
	XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ActivityItem, Desk } from "../lib/api.js";
import { listActivity } from "../lib/api.js";
import { ScrollArea } from "./ui/scroll-area.js";

interface Props {
	desk: Desk;
}

function formatRelativeTime(timestamp: string): string {
	const now = Date.now();
	const diff = now - new Date(timestamp).getTime();
	const seconds = Math.floor(diff / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (seconds < 60) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	if (hours < 24) return `${hours}h ago`;
	if (days < 7) return `${days}d ago`;
	return new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function actorInitials(actor: string): string {
	if (actor === "You") return "YO";
	if (actor === "System") return "SY";
	return actor.slice(0, 2).toUpperCase();
}

function actorColor(actor: string): string {
	if (actor === "You") return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
	if (actor === "System")
		return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
	return "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300";
}

const typeIcons: Record<ActivityItem["type"], typeof Activity> = {
	experiment_created: FlaskConical,
	run_created: Play,
	run_completed: CheckCircle2,
	run_failed: XCircle,
	comment: MessageSquare,
	go_live: Radio,
	run_stopped: Square,
};

export function ActivityView({ desk }: Props) {
	const [items, setItems] = useState<ActivityItem[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		setLoading(true);
		listActivity(desk.id)
			.then(setItems)
			.catch(() => setItems([]))
			.finally(() => setLoading(false));
	}, [desk.id]);

	return (
		<div className="flex flex-col h-full">
			{/* Breadcrumb */}
			<div className="px-6 h-12 flex items-center gap-1.5 text-[13px] text-muted-foreground shrink-0 border-b border-border">
				<span>{desk.name}</span>
				<ChevronRight className="size-3" />
				<span className="text-foreground font-medium">Activity</span>
			</div>

			{/* Content */}
			<ScrollArea className="flex-1">
				<div className="max-w-3xl px-6 py-6">
					{/* Title */}
					<div className="flex items-center gap-2.5 mb-6">
						<Activity className="size-5 text-muted-foreground" />
						<h2 className="text-sm font-semibold">Activity</h2>
					</div>

					{loading ? (
						<div className="text-[13px] text-muted-foreground">Loading...</div>
					) : items.length === 0 ? (
						<div className="text-[13px] text-muted-foreground">No activity yet</div>
					) : (
						<div className="divide-y divide-border">
							{items.map((item) => {
								const Icon = typeIcons[item.type];
								return (
									<div key={item.id} className="flex items-center gap-3 py-2.5 group">
										{/* Actor badge */}
										<div
											className={`flex size-7 items-center justify-center rounded-full text-[10px] font-semibold shrink-0 ${actorColor(item.actor)}`}
										>
											{actorInitials(item.actor)}
										</div>

										{/* Icon */}
										<Icon className="size-3.5 text-muted-foreground shrink-0" />

										{/* Summary + detail */}
										<div className="flex-1 min-w-0 flex items-center gap-1.5">
											<span className="text-[13px] text-foreground">{item.summary}</span>
											{item.detail && (
												<span className="text-[13px] text-muted-foreground truncate">
													— {item.detail}
												</span>
											)}
										</div>

										{/* Timestamp */}
										<span className="text-xs text-muted-foreground shrink-0">
											{formatRelativeTime(item.timestamp)}
										</span>
									</div>
								);
							})}
						</div>
					)}
				</div>
			</ScrollArea>
		</div>
	);
}
