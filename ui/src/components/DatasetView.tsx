import { ChevronRight, Database, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Dataset, Desk } from "../lib/api.js";
import { deleteDataset, listDatasets } from "../lib/api.js";
import { cn } from "../lib/utils.js";
import { ScrollArea } from "./ui/scroll-area.js";

interface Props {
	desk: Desk;
}

function formatDate(dateStr: string): string {
	return new Date(dateStr).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

function formatRelativeTime(timestamp: string): string {
	const diff = Date.now() - new Date(timestamp).getTime();
	const seconds = Math.floor(diff / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (seconds < 60) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	if (hours < 24) return `${hours}h ago`;
	if (days < 7) return `${days}d ago`;
	return formatDate(timestamp);
}

export function DatasetView({ desk }: Props) {
	const [datasets, setDatasets] = useState<Dataset[]>([]);
	const [loading, setLoading] = useState(true);

	const refresh = useCallback(() => {
		setLoading(true);
		listDatasets(desk.id)
			.then(setDatasets)
			.catch(() => setDatasets([]))
			.finally(() => setLoading(false));
	}, [desk.id]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const handleDelete = async (datasetId: string) => {
		await deleteDataset(desk.id, datasetId);
		refresh();
	};

	return (
		<div className="flex flex-col h-full">
			{/* Breadcrumb */}
			<div className="px-6 h-12 flex items-center gap-1.5 text-[13px] text-muted-foreground shrink-0 border-b border-border">
				<span>{desk.name}</span>
				<ChevronRight className="size-3" />
				<span className="text-foreground font-medium">Datasets</span>
			</div>

			{/* Content */}
			<ScrollArea className="flex-1">
				<div className="max-w-3xl px-6 py-6">
					{/* Title */}
					<div className="flex items-center gap-2.5 mb-6">
						<Database className="size-5 text-muted-foreground" />
						<h2 className="text-sm font-semibold">Datasets</h2>
						<span className="text-xs text-muted-foreground">
							Market data downloaded by the agent
						</span>
					</div>

					{loading ? (
						<div className="text-[13px] text-muted-foreground">Loading...</div>
					) : datasets.length === 0 ? (
						<div className="text-[13px] text-muted-foreground">
							No datasets yet. The agent will download market data when running backtests.
						</div>
					) : (
						<div className="space-y-3">
							{datasets.map((ds) => (
								<div key={ds.id} className="rounded-lg border border-border p-4 shadow-sm">
									<div className="flex items-start justify-between gap-3">
										<div className="min-w-0 flex-1">
											{/* Exchange + pairs */}
											<div className="flex items-center gap-2 mb-2">
												<span className="text-[13px] font-semibold">
													{ds.exchange.toUpperCase()}
												</span>
												<div className="flex flex-wrap gap-1">
													{ds.pairs.map((pair) => (
														<span
															key={pair}
															className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground"
														>
															{pair}
														</span>
													))}
												</div>
											</div>

											{/* Metadata row */}
											<div className="flex items-center gap-3 text-xs text-muted-foreground">
												<span
													className={cn(
														"rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide",
													)}
												>
													{ds.timeframe}
												</span>
												<span>
													{formatDate(ds.dateRange.start)} — {formatDate(ds.dateRange.end)}
												</span>
												<span className="text-border">|</span>
												<span>{formatRelativeTime(ds.createdAt)}</span>
											</div>

											{/* Path */}
											<div className="mt-2 text-[11px] font-mono text-muted-foreground/70 truncate">
												{ds.path}
											</div>
										</div>

										{/* Delete */}
										<button
											type="button"
											onClick={() => handleDelete(ds.id)}
											className="p-1.5 rounded text-muted-foreground/50 hover:text-red-500 transition-colors shrink-0"
										>
											<Trash2 className="size-3.5" />
										</button>
									</div>
								</div>
							))}
						</div>
					)}
				</div>
			</ScrollArea>
		</div>
	);
}
