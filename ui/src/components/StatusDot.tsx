import { cn } from "../lib/utils.js";

interface Props {
	status: string;
	className?: string;
}

const statusConfig: Record<string, { color: string; pulse: boolean }> = {
	active: { color: "bg-green-500", pulse: true },
	running: { color: "bg-blue-500", pulse: true },
	completed: { color: "bg-green-500", pulse: false },
	stopped: { color: "bg-gray-400", pulse: false },
	failed: { color: "bg-red-500", pulse: false },
	pending: { color: "bg-yellow-500", pulse: false },
	archived: { color: "bg-gray-400", pulse: false },
};

export function StatusDot({ status, className }: Props) {
	const config = statusConfig[status] ?? { color: "bg-gray-400", pulse: false };

	return (
		<span className={cn("relative flex h-2 w-2 shrink-0", className)}>
			{config.pulse && (
				<span
					className={cn(
						"absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
						config.color,
					)}
				/>
			)}
			<span className={cn("relative inline-flex h-2 w-2 rounded-full", config.color)} />
		</span>
	);
}
