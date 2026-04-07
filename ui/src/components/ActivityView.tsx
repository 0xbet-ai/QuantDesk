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

function actorLabel(actor: string): string {
	if (actor === "You") return "You";
	if (actor === "System") return "System";
	if (actor === "analyst") return "Analyst";
	if (actor === "risk_manager") return "Risk Manager";
	return actor.charAt(0).toUpperCase() + actor.slice(1);
}

function actorBadgeColor(actor: string): string {
	if (actor === "You") return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
	if (actor === "System")
		return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
	if (actor === "risk_manager")
		return "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300";
	return "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300";
}

function actorIconColor(actor: string): string {
	if (actor === "You") return "text-blue-600 dark:text-blue-400";
	if (actor === "System") return "text-amber-600 dark:text-amber-400";
	if (actor === "risk_manager") return "text-orange-600 dark:text-orange-400";
	return "text-purple-600 dark:text-purple-400";
}

function stripActorPrefix(summary: string, actor: string): string {
	// Remove leading actor mention so the badge isn't duplicated.
	// e.g. "You commented" -> "commented", "analyst commented" -> "commented"
	const label = actorLabel(actor);
	const lower = summary.toLowerCase();
	const candidates = [label.toLowerCase(), actor.toLowerCase()];
	for (const c of candidates) {
		if (lower.startsWith(`${c} `)) return summary.slice(c.length + 1);
	}
	return summary;
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
										{/* Actor badge (full name) */}
										<span
											className={`px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0 ${actorBadgeColor(item.actor)}`}
										>
											{actorLabel(item.actor)}
										</span>

										{/* Icon */}
										<Icon className={`size-3.5 shrink-0 ${actorIconColor(item.actor)}`} />

										{/* Summary + detail */}
										<div className="flex-1 min-w-0 flex items-center gap-1.5">
											<span className="text-[13px] text-foreground">
												{stripActorPrefix(item.summary, item.actor)}
											</span>
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
