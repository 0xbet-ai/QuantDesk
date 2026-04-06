import { useEffect, useState } from "react";
import type { Experiment, Run } from "../lib/api.js";
import { goLive, listRuns } from "../lib/api.js";

interface Props {
	experiment: Experiment | null;
	experimentId: string;
}

export function PropsPanel({ experiment, experimentId }: Props) {
	const [runs, setRuns] = useState<Run[]>([]);
	const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

	useEffect(() => {
		listRuns(experimentId)
			.then(setRuns)
			.catch(() => {});
	}, [experimentId]);

	const selectedRun = runs.find((r) => r.id === selectedRunId) ?? null;
	const baseline = runs.find((r) => r.isBaseline) ?? null;

	const handleGoLive = async (runId: string) => {
		try {
			await goLive(runId);
		} catch (err) {
			console.error(err);
		}
	};

	return (
		<div className="p-3">
			{experiment && (
				<div className="mb-4">
					<div className="text-xs font-semibold text-gray-500 uppercase">Experiment</div>
					<div className="text-sm mt-1">Status: {experiment.status}</div>
					<div className="text-sm">Runs: {runs.length}</div>
				</div>
			)}

			<div className="text-xs font-semibold text-gray-500 uppercase mb-1">Runs</div>
			<table className="w-full text-xs">
				<thead>
					<tr className="text-gray-500">
						<th className="text-left py-1">#</th>
						<th className="text-right py-1">Ret</th>
						<th className="text-right py-1">DD</th>
					</tr>
				</thead>
				<tbody>
					{runs.map((run) => {
						const ret = run.result?.returnPct;
						const dd = run.result?.drawdownPct;
						const delta =
							!run.isBaseline && baseline?.result && run.result
								? (run.result.returnPct - baseline.result.returnPct).toFixed(1)
								: null;
						return (
							<tr
								key={run.id}
								onClick={() => setSelectedRunId(run.id)}
								onKeyDown={(e) => e.key === "Enter" && setSelectedRunId(run.id)}
								className={`cursor-pointer hover:bg-gray-800 ${
									run.id === selectedRunId ? "bg-gray-800" : ""
								}`}
							>
								<td className="py-1">{run.runNumber}</td>
								<td className="text-right py-1">
									{run.status === "running"
										? "running.."
										: ret != null
											? `${ret > 0 ? "+" : ""}${ret.toFixed(1)}`
											: "—"}
								</td>
								<td className="text-right py-1">
									{dd != null ? dd.toFixed(1) : "—"}
									{delta && <span className="text-green-400 ml-1">(+{delta})</span>}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>

			{selectedRun && (
				<div className="mt-4 border-t border-gray-800 pt-3">
					<div className="text-xs font-semibold text-gray-500 uppercase mb-2">
						Run #{selectedRun.runNumber} detail
					</div>
					{selectedRun.result && baseline?.result && !selectedRun.isBaseline && (
						<div className="text-sm text-green-400">
							vs base {selectedRun.result.returnPct - baseline.result.returnPct > 0 ? "+" : ""}
							{(selectedRun.result.returnPct - baseline.result.returnPct).toFixed(1)}%
						</div>
					)}
					{selectedRun.result && (
						<>
							<div className="text-sm">WR {(selectedRun.result.winRate * 100).toFixed(0)}%</div>
							<div className="text-sm">{selectedRun.result.totalTrades} trades</div>
						</>
					)}
					{selectedRun.mode === "backtest" && selectedRun.status === "completed" && (
						<button
							type="button"
							onClick={() => handleGoLive(selectedRun.id)}
							className="mt-3 w-full px-3 py-2 bg-green-600 hover:bg-green-500 rounded text-sm font-medium"
						>
							Go Live
						</button>
					)}
				</div>
			)}
		</div>
	);
}
