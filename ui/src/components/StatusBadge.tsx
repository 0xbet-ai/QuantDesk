import { cn } from "../lib/utils.js";

const statusColors: Record<string, string> = {
	running: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300",
	queued: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300",
	completed: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
	succeeded: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
	failed: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
	error: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
	active: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
	pending: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300",
	draft: "bg-muted text-muted-foreground",
};

const defaultColor = "bg-muted text-muted-foreground";

export function StatusBadge({ status }: { status: string }) {
	return (
		<span
			className={cn(
				"inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap shrink-0",
				statusColors[status] ?? defaultColor,
			)}
		>
			{status.replace("_", " ")}
		</span>
	);
}
