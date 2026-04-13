import { Database, Folder, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Dataset, DatasetPreview, Desk } from "../lib/api.js";
import { deleteDataset, listDatasets, previewDataset, previewDatasetGlobal } from "../lib/api.js";
import { cn } from "../lib/utils.js";
import { Button } from "./ui/button.js";
import { Input } from "./ui/input.js";

interface Props {
	desk: Desk;
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

/**
 * Per-desk datasets view. Dense list grouped by exchange with a single
 * search box that matches across pair / exchange / timeframe / experiment /
 * date range, and recent-first ordering. Adapted from the previous global
 * datasets view — scoping is now automatic via `listDatasets(desk.id)`,
 * which joins through `desk_datasets` on the server.
 */
export function DatasetView({ desk }: Props) {
	const [datasets, setDatasets] = useState<Dataset[]>([]);
	const [loading, setLoading] = useState(true);
	const [confirmingId, setConfirmingId] = useState<string | null>(null);
	const [deletingId, setDeletingId] = useState<string | null>(null);
	const [previewing, setPreviewing] = useState<Dataset | null>(null);
	const [query, setQuery] = useState("");

	const refresh = useCallback(() => {
		setLoading(true);
		listDatasets(desk.id)
			.then(setDatasets)
			.catch(() => setDatasets([]))
			.finally(() => setLoading(false));
	}, [desk.id]);

	useEffect(() => {
		refresh();
		// Agents create datasets in the background as they fetch data. The
		// server doesn't emit a `dataset.new` WS event yet, so we poll every
		// 4s while the view is mounted and refresh on window focus so a
		// Cmd-Tab back picks up new rows immediately.
		const interval = setInterval(refresh, 4000);
		const onFocus = () => refresh();
		window.addEventListener("focus", onFocus);
		return () => {
			clearInterval(interval);
			window.removeEventListener("focus", onFocus);
		};
	}, [refresh]);

	const handleDelete = async (id: string) => {
		setDeletingId(id);
		try {
			await deleteDataset(desk.id, id);
			setConfirmingId(null);
			refresh();
		} catch (err) {
			console.error("Failed to delete dataset:", err);
		} finally {
			setDeletingId(null);
		}
	};

	// Recent first + client-side search, then group by exchange.
	const { filtered, grouped } = useMemo(() => {
		const sorted = [...datasets].sort(
			(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
		);
		const q = query.trim().toLowerCase();
		const list = q
			? sorted.filter((d) => {
					const blob = [
						d.exchange,
						d.pairs.join(" "),
						d.timeframe,
						d.dateRange.start,
						d.dateRange.end,
						d.createdByExperimentTitle ?? "",
						d.createdByExperimentNumber != null ? `#${d.createdByExperimentNumber}` : "",
					]
						.join(" ")
						.toLowerCase();
					return blob.includes(q);
				})
			: sorted;
		const groups = new Map<string, Dataset[]>();
		for (const d of list) {
			const key = d.exchange.toLowerCase();
			const arr = groups.get(key) ?? [];
			arr.push(d);
			groups.set(key, arr);
		}
		return { filtered: list, grouped: groups };
	}, [datasets, query]);

	return (
		<div className="flex-1 flex flex-col min-h-0">
			<div className="h-12 shrink-0 border-b border-border flex items-center px-6 gap-3">
				<div className="flex items-center gap-2 min-w-0">
					<Database className="size-4 text-muted-foreground shrink-0" />
					<h1 className="text-sm font-medium">Datasets</h1>
				</div>
				<div className="flex-1" />
				<div className="relative">
					<Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/70 pointer-events-none" />
					<Input
						type="search"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search pair, exchange, timeframe…"
						className="h-8 w-64 pl-8 text-xs"
					/>
				</div>
			</div>

			<div className="flex-1 overflow-y-auto">
				{loading ? (
					<div className="p-6 text-sm text-muted-foreground">Loading…</div>
				) : datasets.length === 0 ? (
					<div className="p-6 text-sm text-muted-foreground">
						No datasets yet. The agent will download market data here as experiments run.
					</div>
				) : filtered.length === 0 ? (
					<div className="p-6 text-sm text-muted-foreground">
						No datasets match{" "}
						<span className="font-mono text-foreground">&ldquo;{query}&rdquo;</span>.{" "}
						<button
							type="button"
							onClick={() => setQuery("")}
							className="underline hover:text-foreground"
						>
							Clear search
						</button>
					</div>
				) : (
					<div className="px-3 py-2 space-y-4">
						{[...grouped.entries()].map(([exchange, items]) => (
							<div key={exchange}>
								<div className="flex items-center gap-2 px-3 py-1.5 mb-1">
									<Database className="size-3.5 text-muted-foreground/60" />
									<span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
										{exchange}
									</span>
									<span className="text-[11px] text-muted-foreground/50">
										{items.length} dataset{items.length !== 1 ? "s" : ""}
									</span>
								</div>
								<div className="pl-6">
									{items.map((d) => (
										<DatasetRow
											key={d.id}
											dataset={d}
											confirming={confirmingId === d.id}
											deleting={deletingId === d.id}
											onOpen={() => setPreviewing(d)}
											onStartConfirm={() => setConfirmingId(d.id)}
											onCancelConfirm={() => setConfirmingId(null)}
											onConfirmDelete={() => handleDelete(d.id)}
										/>
									))}
								</div>
							</div>
						))}
					</div>
				)}
			</div>
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

interface DatasetRowProps {
	dataset: Dataset;
	confirming: boolean;
	deleting: boolean;
	onOpen: () => void;
	onStartConfirm: () => void;
	onCancelConfirm: () => void;
	onConfirmDelete: () => void;
}

function DatasetRow({
	dataset: d,
	confirming,
	deleting,
	onOpen,
	onStartConfirm,
	onCancelConfirm,
	onConfirmDelete,
}: DatasetRowProps) {
	const pairsText = d.pairs
		.map((p) => {
			// CCXT perp symbols look like "BTC/USDC:USDC" — strip the
			// `:settle` suffix for compactness (the perp badge conveys
			// the same info).
			const [pair] = p.split(":");
			return pair;
		})
		.join(", ");
	// "futures" is QuantDesk's shorthand for perpetual swaps (crypto perps).
	// Read the explicit tradingMode column rather than inferring from CCXT
	// `:settle` suffixes — MCP-registered rows historically lacked the
	// suffix and were misclassified as spot.
	const isPerp = d.tradingMode === "futures";

	return (
		<div
			className={cn(
				"group flex items-center gap-3 h-10 px-3 rounded-md cursor-pointer",
				"hover:bg-muted/40",
			)}
			onClick={onOpen}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onOpen();
				}
			}}
			role="button"
			tabIndex={0}
			title={`${d.path}\nAdded ${new Date(d.createdAt).toLocaleString()}`}
		>
			<Folder className="size-4 text-muted-foreground/70 shrink-0" />
			<div className="flex items-baseline gap-1.5 min-w-0 shrink-0">
				<span className="text-[13px] font-medium text-foreground truncate">{pairsText}</span>
				{isPerp && (
					<span className="text-[9px] px-1 py-px rounded bg-muted text-muted-foreground uppercase leading-none">
						perp
					</span>
				)}
			</div>
			<span className="text-[11px] text-muted-foreground font-mono shrink-0">{d.timeframe}</span>
			<span className="text-[11px] text-muted-foreground/80 shrink-0">{d.exchange}</span>
			<span className="text-[11px] text-muted-foreground/80 font-mono shrink-0 hidden md:inline">
				{d.dateRange.start} → {d.dateRange.end}
			</span>
			<div className="flex-1" />
			{d.createdByExperimentNumber != null && (
				<span className="text-[11px] text-muted-foreground/70 truncate max-w-[280px] hidden lg:inline">
					#{d.createdByExperimentNumber}
					{d.createdByExperimentTitle && (
						<span className="text-muted-foreground/50">{` · ${d.createdByExperimentTitle}`}</span>
					)}
				</span>
			)}
			<span className="text-[11px] text-muted-foreground/60 tabular-nums shrink-0 w-[68px] text-right hidden sm:inline">
				{formatRelative(d.createdAt)}
			</span>
			{confirming ? (
				<div
					className="flex items-center gap-1 shrink-0"
					onClick={(e) => e.stopPropagation()}
					onKeyDown={(e) => e.stopPropagation()}
					role="presentation"
				>
					<Button
						variant="destructive"
						size="sm"
						className="h-6 px-2 text-[11px]"
						onClick={onConfirmDelete}
						disabled={deleting}
					>
						{deleting ? "Deleting…" : "Confirm"}
					</Button>
					<Button
						variant="ghost"
						size="sm"
						className="h-6 px-2 text-[11px]"
						onClick={onCancelConfirm}
						disabled={deleting}
					>
						Cancel
					</Button>
				</div>
			) : (
				<Button
					variant="ghost"
					size="icon-sm"
					className={cn(
						"shrink-0 text-muted-foreground hover:text-destructive",
						"opacity-0 group-hover:opacity-100 transition-opacity",
					)}
					onClick={(e) => {
						e.stopPropagation();
						onStartConfirm();
					}}
					title="Delete dataset"
				>
					<Trash2 className="size-3.5" />
				</Button>
			)}
		</div>
	);
}

function formatRelative(iso: string): string {
	const then = new Date(iso).getTime();
	const now = Date.now();
	const diff = Math.max(0, now - then);
	const sec = Math.floor(diff / 1000);
	if (sec < 60) return `${sec}s ago`;
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m ago`;
	const hr = Math.floor(min / 60);
	if (hr < 24) return `${hr}h ago`;
	const day = Math.floor(hr / 24);
	if (day < 14) return `${day}d ago`;
	const wk = Math.floor(day / 7);
	if (wk < 8) return `${wk}w ago`;
	const mo = Math.floor(day / 30);
	if (mo < 12) return `${mo}mo ago`;
	const yr = Math.floor(day / 365);
	return `${yr}y ago`;
}
