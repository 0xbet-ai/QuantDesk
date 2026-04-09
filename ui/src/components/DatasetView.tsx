import { ChevronRight, Database, Eye, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Dataset, DatasetPreview, Desk } from "../lib/api.js";
import {
	deleteDataset,
	listDatasets,
	previewDataset,
	previewDatasetGlobal,
} from "../lib/api.js";
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

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function DatasetPreviewModal({
	dataset,
	deskId,
	onClose,
}: {
	dataset: Dataset;
	/** Omit to fetch via the global datasets endpoint (no desk context). */
	deskId?: string;
	onClose: () => void;
}) {
	const [preview, setPreview] = useState<DatasetPreview | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setLoading(true);
		setError(null);
		const loader = deskId
			? previewDataset(deskId, dataset.id, 100)
			: previewDatasetGlobal(dataset.id, 100);
		loader
			.then(setPreview)
			.catch((err) => setError(err.message))
			.finally(() => setLoading(false));
	}, [deskId, dataset.id]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	return (
		<dialog
			open
			aria-modal="true"
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-in fade-in duration-200 w-full h-full max-w-none max-h-none m-0 p-0"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
			onKeyDown={(e) => {
				if (e.key === "Escape") onClose();
			}}
		>
			<div className="relative w-[90vw] max-w-5xl max-h-[85vh] flex flex-col rounded-xl border border-border bg-background shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
				{/* Header */}
				<div className="flex items-center justify-between px-5 py-4 border-b border-border">
					<div className="flex items-center gap-3 min-w-0">
						<Database className="size-4 text-muted-foreground shrink-0" />
						<div className="min-w-0">
							<div className="text-sm font-semibold flex items-center gap-2">
								<span>{dataset.exchange.toUpperCase()}</span>
								<span className="text-muted-foreground">·</span>
								<span className="font-mono text-xs">{dataset.pairs.join(", ")}</span>
								<span className="text-muted-foreground">·</span>
								<span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
									{dataset.timeframe}
								</span>
							</div>
							<div className="text-[11px] text-muted-foreground font-mono mt-0.5 truncate">
								{dataset.path}
							</div>
						</div>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors shrink-0"
					>
						<X className="size-4" />
					</button>
				</div>

				{/* Stats */}
				{preview && (
					<div className="flex items-center gap-4 px-5 py-2 border-b border-border bg-muted/30 text-[11px] text-muted-foreground">
						<span>
							<span className="font-medium text-foreground">
								{preview.totalRows.toLocaleString()}
							</span>{" "}
							rows
						</span>
						<span>
							<span className="font-medium text-foreground">{preview.headers.length}</span> columns
						</span>
						<span>
							<span className="font-medium text-foreground">{formatBytes(preview.fileSize)}</span>
						</span>
						<span className="text-muted-foreground/70">
							Showing first {preview.rows.length} rows
						</span>
					</div>
				)}

				{/* Body */}
				<div className="flex-1 overflow-auto">
					{loading ? (
						<div className="flex items-center justify-center h-64 text-[13px] text-muted-foreground">
							Loading preview...
						</div>
					) : error ? (
						<div className="flex items-center justify-center h-64 text-[13px] text-muted-foreground">
							{error}
						</div>
					) : preview ? (
						<table className="w-full text-[11px] font-mono tabular-nums">
							<thead className="sticky top-0 bg-muted/80 backdrop-blur z-10">
								<tr>
									<th className="px-3 py-2 text-right text-muted-foreground/60 font-normal w-12 border-b border-border">
										#
									</th>
									{preview.headers.map((h) => (
										<th
											key={h}
											className="px-3 py-2 text-left font-semibold text-foreground border-b border-border"
										>
											{h}
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								{preview.rows.map((row, i) => {
									const rowKey = `row-${i}`;
									return (
										<tr key={rowKey} className="hover:bg-accent/50 transition-colors">
											<td className="px-3 py-1.5 text-right text-muted-foreground/40 border-b border-border/30">
												{i + 1}
											</td>
											{row.map((cell, j) => {
												const cellKey = `${rowKey}-${j}`;
												return (
													<td
														key={cellKey}
														className="px-3 py-1.5 text-foreground/80 border-b border-border/30"
													>
														{cell}
													</td>
												);
											})}
										</tr>
									);
								})}
							</tbody>
						</table>
					) : null}
				</div>
			</div>
		</dialog>
	);
}

export function DatasetView({ desk }: Props) {
	const [datasets, setDatasets] = useState<Dataset[]>([]);
	const [loading, setLoading] = useState(true);
	const [previewing, setPreviewing] = useState<Dataset | null>(null);

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
						<div className="text-[13px] text-muted-foreground">No datasets yet.</div>
					) : (
						<div className="space-y-6">
							{Object.entries(
								datasets.reduce<Record<string, typeof datasets>>((acc, ds) => {
									const key = ds.exchange.toLowerCase();
									(acc[key] ??= []).push(ds);
									return acc;
								}, {}),
							).map(([exchange, items]) => (
								<div key={exchange}>
									<div className="flex items-center gap-2 mb-3">
										<Database className="size-3.5 text-muted-foreground/60" />
										<span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
											{exchange}
										</span>
										<span className="text-[11px] text-muted-foreground/50">
											{items.length} dataset{items.length !== 1 ? "s" : ""}
										</span>
									</div>
									<div className="space-y-2 pl-5">
										{items.map((ds) => (
											<button
												type="button"
												key={ds.id}
												onClick={() => setPreviewing(ds)}
												className="w-full text-left rounded-lg border border-border p-3 shadow-sm hover:bg-accent/30 transition-colors group"
											>
												<div className="flex items-center justify-between gap-3">
													<div className="min-w-0 flex-1">
														<div className="flex items-center gap-2 mb-1">
															<span className="text-[13px] font-medium font-mono">
																{ds.pairs.map((p) => p.split(":")[0]).join(", ")}
															</span>
															{ds.pairs.some((p) => p.includes(":")) && (
																<span className="text-[9px] px-1 py-px rounded bg-muted text-muted-foreground uppercase leading-none">
																	perp
																</span>
															)}
														</div>
														<div className="flex items-center gap-3 text-xs text-muted-foreground">
															<span className={cn("rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide")}>
																{ds.timeframe}
															</span>
															<span>
																{formatDate(ds.dateRange.start)} — {formatDate(ds.dateRange.end)}
															</span>
															<span className="text-border">|</span>
															<span>{formatRelativeTime(ds.createdAt)}</span>
														</div>
													</div>
													<div className="flex items-center gap-1 shrink-0">
														<div className="p-1.5 rounded text-muted-foreground/40 group-hover:text-foreground transition-colors">
															<Eye className="size-3.5" />
														</div>
														<button
															type="button"
															onClick={(e) => {
																e.stopPropagation();
																handleDelete(ds.id);
															}}
															className="p-1.5 rounded text-muted-foreground/50 hover:text-red-500 transition-colors"
														>
															<Trash2 className="size-3.5" />
														</button>
													</div>
												</div>
											</button>
										))}
									</div>
								</div>
							))}
						</div>
					)}
				</div>
			</ScrollArea>

			{previewing && (
				<DatasetPreviewModal
					dataset={previewing}
					deskId={desk.id}
					onClose={() => setPreviewing(null)}
				/>
			)}
		</div>
	);
}
