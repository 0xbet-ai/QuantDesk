/**
 * Path picker modal — used by the wizard's Custom Strategy panel to let
 * users pick a seed code directory (mode="folder") or an external dataset
 * file (mode="file") without typing absolute paths.
 *
 * Backed by `GET /api/fs/browse?path=...&includeFiles=...` which filters
 * the same deny-list as `validateSeedPath`. Localhost dev tool — the
 * server has full host fs access, so the deny-list is the only guard that
 * matters.
 */

import { File, Folder, FolderUp, X } from "lucide-react";
import { useEffect, useState } from "react";
import { type FsBrowseEntry, browseFs } from "../lib/api";
import { Button } from "./ui/button";

interface Props {
	mode?: "folder" | "file";
	initialPath?: string;
	onSelect: (path: string) => void;
	onClose: () => void;
}

export function FolderPickerModal({ mode = "folder", initialPath, onSelect, onClose }: Props) {
	const [currentPath, setCurrentPath] = useState<string | null>(null);
	const [parent, setParent] = useState<string | null>(null);
	const [entries, setEntries] = useState<FsBrowseEntry[]>([]);
	const [selectedFile, setSelectedFile] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const includeFiles = mode === "file";

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError(null);
		browseFs(initialPath, { includeFiles })
			.then((res) => {
				if (cancelled) return;
				setCurrentPath(res.path);
				setParent(res.parent);
				setEntries(res.entries);
				setSelectedFile(null);
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				setError(err instanceof Error ? err.message : "Failed to browse");
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
		// initialPath is the seed; navigation re-fetches via `navigate` below
	}, [initialPath, includeFiles]);

	const navigate = (path: string) => {
		setLoading(true);
		setError(null);
		setSelectedFile(null);
		browseFs(path, { includeFiles })
			.then((res) => {
				setCurrentPath(res.path);
				setParent(res.parent);
				setEntries(res.entries);
			})
			.catch((err: unknown) => {
				setError(err instanceof Error ? err.message : "Failed to browse");
			})
			.finally(() => setLoading(false));
	};

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
			onKeyDown={(e) => {
				if (e.key === "Escape") onClose();
			}}
		>
			<div className="w-[520px] max-h-[70vh] flex flex-col rounded-xl border border-border bg-background shadow-xl">
				<div className="flex items-center justify-between border-b border-border px-4 py-3">
					<div className="text-sm font-semibold">
						{mode === "file" ? "Pick a file" : "Pick a folder"}
					</div>
					<button
						type="button"
						onClick={onClose}
						className="text-foreground/40 hover:text-foreground transition-colors"
						aria-label="close"
					>
						<X className="size-4" />
					</button>
				</div>

				<div className="border-b border-border px-4 py-2 flex items-center gap-2">
					<button
						type="button"
						disabled={!parent}
						onClick={() => parent && navigate(parent)}
						className="text-foreground/60 hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
						aria-label="parent folder"
					>
						<FolderUp className="size-4" />
					</button>
					<div className="text-[11px] font-mono text-foreground/70 truncate flex-1">
						{currentPath ?? "…"}
					</div>
				</div>

				<div className="flex-1 overflow-y-auto p-2">
					{loading ? (
						<div className="text-xs text-foreground/40 px-2 py-1">Loading…</div>
					) : error ? (
						<div className="text-xs text-red-500 px-2 py-1">{error}</div>
					) : entries.length === 0 ? (
						<div className="text-xs text-foreground/40 px-2 py-1">
							{mode === "file" ? "Nothing here." : "No subfolders here."}
						</div>
					) : (
						<ul className="space-y-0.5">
							{entries.map((entry) => (
								<li key={entry.path}>
									<button
										type="button"
										onClick={() =>
											entry.kind === "dir" ? navigate(entry.path) : setSelectedFile(entry.path)
										}
										className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-left ${
											selectedFile === entry.path ? "bg-accent" : "hover:bg-accent"
										}`}
									>
										{entry.kind === "dir" ? (
											<Folder className="size-3.5 text-foreground/50 shrink-0" />
										) : (
											<File className="size-3.5 text-foreground/50 shrink-0" />
										)}
										<span className="truncate">{entry.name}</span>
									</button>
								</li>
							))}
						</ul>
					)}
				</div>

				<div className="border-t border-border px-4 py-3 flex items-center justify-end gap-2">
					<Button type="button" variant="ghost" size="sm" onClick={onClose} className="h-8 text-xs">
						Cancel
					</Button>
					{mode === "file" ? (
						<Button
							type="button"
							size="sm"
							onClick={() => selectedFile && onSelect(selectedFile)}
							disabled={!selectedFile}
							className="h-8 text-xs"
						>
							Select this file
						</Button>
					) : (
						<Button
							type="button"
							size="sm"
							onClick={() => currentPath && onSelect(currentPath)}
							disabled={!currentPath}
							className="h-8 text-xs"
						>
							Select this folder
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}
