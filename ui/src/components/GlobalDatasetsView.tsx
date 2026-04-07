import { Database, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Dataset } from "../lib/api.js";
import { deleteDatasetGlobal, listAllDatasets } from "../lib/api.js";
import { Button } from "./ui/button.js";

export function GlobalDatasetsView() {
	const [datasets, setDatasets] = useState<Dataset[]>([]);
	const [loading, setLoading] = useState(true);

	const refresh = () => {
		setLoading(true);
		listAllDatasets()
			.then(setDatasets)
			.catch(() => setDatasets([]))
			.finally(() => setLoading(false));
	};

	useEffect(() => {
		refresh();
	}, []);

	const handleDelete = async (id: string) => {
		if (!window.confirm("Delete this dataset? All desks linked to it will lose access.")) return;
		try {
			await deleteDatasetGlobal(id);
			refresh();
		} catch (err) {
			console.error("Failed to delete dataset:", err);
		}
	};

	return (
		<div className="flex-1 flex flex-col min-h-0">
			<div className="h-12 shrink-0 border-b border-border flex items-center px-6">
				<div className="flex items-center gap-2">
					<Database className="size-4 text-muted-foreground" />
					<h1 className="text-sm font-medium">Datasets</h1>
					<span className="text-xs text-muted-foreground">
						· shared across all desks
					</span>
				</div>
			</div>

			<div className="flex-1 overflow-y-auto p-6">
				{loading ? (
					<div className="text-sm text-muted-foreground">Loading...</div>
				) : datasets.length === 0 ? (
					<div className="text-sm text-muted-foreground">
						No datasets yet. Approve a [PROPOSE_DATA_FETCH] from an agent to populate the
						shared cache.
					</div>
				) : (
					<div className="border border-border rounded-md divide-y divide-border">
						{datasets.map((d) => (
							<div
								key={d.id}
								className="flex items-center justify-between px-4 py-3 hover:bg-muted/30"
							>
								<div className="flex-1 min-w-0">
									<div className="text-sm font-medium">
										{d.pairs.join(", ")} · {d.timeframe}
									</div>
									<div className="text-xs text-muted-foreground mt-0.5">
										{d.exchange} · {d.dateRange.start} → {d.dateRange.end}
									</div>
									<div className="text-[11px] text-muted-foreground/70 mt-0.5 font-mono truncate">
										{d.path}
									</div>
								</div>
								<Button
									variant="ghost"
									size="icon-sm"
									className="text-muted-foreground hover:text-destructive"
									onClick={() => handleDelete(d.id)}
									title="Delete dataset"
								>
									<Trash2 className="size-4" />
								</Button>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
