import { Database, Folder, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Dataset } from "../lib/api.js";
import { deleteDatasetGlobal, listAllDatasets } from "../lib/api.js";
import { cn } from "../lib/utils.js";
import { DatasetPreviewModal } from "./DatasetView.js";
import { Button } from "./ui/button.js";
import { Input } from "./ui/input.js";

/**
 * Shared global datasets view. Compact list with a folder icon per row,
 * a single search box that matches across pair / exchange / timeframe /
 * source desk / experiment / date range, and recent-first ordering. We
 * intentionally avoid a grid/icon view — dataset rows are visually
 * uniform so spatial scanning doesn't beat a dense list.
 */
export function GlobalDatasetsView() {
	const [datasets, setDatasets] = useState<Dataset[]>([]);
	const [loading, setLoading] = useState(true);
	const [confirmingId, setConfirmingId] = useState<string | null>(null);
	const [deletingId, setDeletingId] = useState<string | null>(null);
	const [previewing, setPreviewing] = useState<Dataset | null>(null);
	const [query, setQuery] = useState("");

	const refresh = () => {
		setLoading(true);
		listAllDatasets()
			.then(setDatasets)
			.catch(() => setDatasets([]))
			.finally(() => setLoading(false));
	};

	useEffect(() => {
		refresh();
		// Datasets are created by background agent turns on other desks, and
		// the server doesn't emit a global `dataset.new` WS event yet. Poll
		// every 4s while the view is mounted, and refresh on window focus so
		// Cmd-Tab back from another app picks up new rows immediately.
		const interval = setInterval(refresh, 4000);
		const onFocus = () => refresh();
		window.addEventListener("focus", onFocus);
		return () => {
			clearInterval(interval);
			window.removeEventListener("focus", onFocus);
		};
	}, []);

	const handleDelete = async (id: string) => {
		setDeletingId(id);
		try {
			await deleteDatasetGlobal(id);
			setConfirmingId(null);
			refresh();
		} catch (err) {
			console.error("Failed to delete dataset:", err);
		} finally {
			setDeletingId(null);
		}
	};

	// Recent first + client-side search. For hundreds of rows this is still
	// instant; if we ever ship a global list beyond that, lift this to the
	// server API. The search blob keeps matching logic in one place.
	const filtered = useMemo(() => {
		const sorted = [...datasets].sort(
			(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
		);
		const q = query.trim().toLowerCase();
		if (!q) return sorted;
		return sorted.filter((d) => {
			const blob = [
				d.exchange,
				d.pairs.join(" "),
				d.timeframe,
				d.dateRange.start,
				d.dateRange.end,
				d.createdByDeskName ?? "",
				d.createdByExperimentTitle ?? "",
				d.createdByExperimentNumber != null ? `#${d.createdByExperimentNumber}` : "",
			]
				.join(" ")
				.toLowerCase();
			return blob.includes(q);
		});
	}, [datasets, query]);

	return (
		<div className="flex-1 flex flex-col min-h-0">
			<div className="h-12 shrink-0 border-b border-border flex items-center px-6 gap-3">
				<div className="flex items-center gap-2 min-w-0">
					<Database className="size-4 text-muted-foreground shrink-0" />
					<h1 className="text-sm font-medium">Datasets</h1>
					<span className="text-xs text-muted-foreground hidden sm:inline">
						· shared across all desks
					</span>
				</div>
				<div className="flex-1" />
				<div className="relative">
					<Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/70 pointer-events-none" />
					<Input
						type="search"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search pair, exchange, desk…"
						className="h-8 w-64 pl-8 text-xs"
					/>
				</div>
			</div>

			<div className="flex-1 overflow-y-auto">
				{loading ? (
					<div className="p-6 text-sm text-muted-foreground">Loading…</div>
				) : datasets.length === 0 ? (
					<div className="p-6 text-sm text-muted-foreground">
						No datasets yet. Agents create them automatically as they fetch data.
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
					<div className="px-3 py-2">
						{filtered.map((d) => (
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
				)}
			</div>
			{previewing && (
				<DatasetPreviewModal
					dataset={previewing}
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
	const hasPerp = d.pairs.some((p) => p.includes(":"));

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
				<span className="text-[13px] font-medium text-foreground truncate">
					{pairsText}
				</span>
				{hasPerp && (
					<span className="text-[9px] px-1 py-px rounded bg-muted text-muted-foreground uppercase leading-none">
						perp
					</span>
				)}
			</div>
			<span className="text-[11px] text-muted-foreground font-mono shrink-0">
				{d.timeframe}
			</span>
			<span className="text-[11px] text-muted-foreground/80 shrink-0">
				{d.exchange}
			</span>
			<span className="text-[11px] text-muted-foreground/80 font-mono shrink-0 hidden md:inline">
				{d.dateRange.start} → {d.dateRange.end}
			</span>
			<div className="flex-1" />
			{(d.createdByDeskName || d.createdByExperimentTitle) && (
				<span className="text-[11px] text-muted-foreground/70 truncate max-w-[280px] hidden lg:inline">
					{d.createdByDeskName ?? "deleted desk"}
					{d.createdByExperimentNumber != null && (
						<span className="text-muted-foreground/50">
							{" · #"}
							{d.createdByExperimentNumber}
						</span>
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
