import { ArrowLeft, Bot, Shield } from "lucide-react";
import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import { useNavigate, useParams } from "react-router-dom";
import remarkGfm from "remark-gfm";
import { StatusBadge } from "../components/StatusBadge.js";
import { type TurnDetail, getTurn } from "../lib/api.js";
import { cn } from "../lib/utils.js";

/**
 * Phase 27 step 7 — read-only turn detail view. Rendered at
 * /desks/:deskId/turns/:turnId. Pulls /api/turns/:id once and shows the
 * lifecycle row, every comment emitted inside the turn, and every run the
 * turn triggered. This is where the TurnCard's "Open" button routes — and
 * because the turn's agent transcript is always present the page is never
 * empty, fixing the old "Open run" dead-end.
 */
export function TurnDetailPage() {
	const { turnId, deskId } = useParams<{ turnId: string; deskId: string }>();
	const navigate = useNavigate();
	const [data, setData] = useState<TurnDetail | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!turnId) return;
		getTurn(turnId)
			.then(setData)
			.catch((err) => setError(err instanceof Error ? err.message : "Failed to load turn"));
	}, [turnId]);

	if (error) {
		return <div className="p-6 text-sm text-red-600">{error}</div>;
	}
	if (!data) {
		return <div className="p-6 text-sm text-muted-foreground">Loading turn…</div>;
	}

	const { turn, comments, runs } = data;
	const isFailed = turn.status === "failed" || turn.status === "stopped";
	const isAwaitingValidation = turn.status === "awaiting_validation";
	const isAnalyst = turn.agentRole !== "risk_manager";
	const RoleIcon = isAnalyst ? Bot : Shield;

	return (
		<div className="h-screen overflow-y-auto">
			<div className="mx-auto max-w-3xl space-y-4 p-6">
				<button
					type="button"
					onClick={() => navigate(`/desks/${deskId}/experiments/${turn.experimentId}`)}
					className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
				>
					<ArrowLeft className="h-3 w-3" />
					Back to experiment
				</button>

				<div
					className={cn(
						"overflow-hidden rounded-xl border bg-background/80 shadow-[0_18px_50px_rgba(6,182,212,0.06)]",
						isFailed ? "border-red-500/30" : "border-cyan-500/25",
					)}
				>
					<div
						className={cn(
							"border-b border-border/60 px-4 py-3",
							isFailed ? "bg-red-500/[0.05]" : "bg-cyan-500/[0.04]",
						)}
					>
						<div
							className={cn(
								"text-xs font-semibold uppercase tracking-[0.18em]",
								isFailed ? "text-red-700 dark:text-red-300" : "text-cyan-700 dark:text-cyan-300",
							)}
						>
							Agent Turn — {turn.status}
						</div>
						<div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
							<RoleIcon className="h-3 w-3" />
							<span>{isAnalyst ? "Analyst" : "Risk Manager"}</span>
							<span>·</span>
							<span>{new Date(turn.startedAt).toLocaleString("en-US")}</span>
							{turn.endedAt && (
								<>
									<span>→</span>
									<span>{new Date(turn.endedAt).toLocaleTimeString("en-US")}</span>
								</>
							)}
							<StatusBadge
								status={
									turn.status === "running"
										? "running"
										: isAwaitingValidation
											? "running"
											: isFailed
												? "failed"
												: "completed"
								}
							/>
						</div>
						{turn.failureReason && (
							<div className="mt-2 text-[11px] font-mono text-red-600 dark:text-red-400">
								{turn.failureReason}
							</div>
						)}
					</div>

					<div className="space-y-4 px-4 py-4">
						<section>
							<h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
								Comments ({comments.length})
							</h3>
							{comments.length === 0 ? (
								<div className="text-xs text-muted-foreground">
									No comments were emitted inside this turn.
								</div>
							) : (
								<div className="space-y-2">
									{comments.map((c) => (
										<div key={c.id} className="rounded-md border border-border p-3">
											<div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
												<span className="font-medium">{c.author}</span>
												<span>·</span>
												<span>{new Date(c.createdAt).toLocaleTimeString("en-US")}</span>
											</div>
											<div className="prose prose-sm prose-neutral dark:prose-invert max-w-none text-[13px] prose-p:my-2 prose-ul:my-2 prose-li:my-0.5 prose-headings:mt-4 prose-headings:mb-2">
												<Markdown remarkPlugins={[remarkGfm]}>{c.content}</Markdown>
											</div>
										</div>
									))}
								</div>
							)}
						</section>

						<section>
							<h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
								Runs ({runs.length})
							</h3>
							{runs.length === 0 ? (
								<div className="text-xs text-muted-foreground">
									This turn did not trigger a backtest.
								</div>
							) : (
								<div className="space-y-2">
									{runs.map((r) => (
										<div
											key={r.id}
											className="flex items-center justify-between rounded-md border border-border p-3 text-xs"
										>
											<div className="flex items-center gap-3">
												<span className="font-medium">Run #{r.runNumber}</span>
												<StatusBadge status={r.status} />
												<span className="text-muted-foreground">{r.mode}</span>
											</div>
											<button
												type="button"
												onClick={() =>
													navigate(`/desks/${deskId}/experiments/${turn.experimentId}/runs/${r.id}`)
												}
												className="text-cyan-700 hover:underline dark:text-cyan-300"
											>
												Open run →
											</button>
										</div>
									))}
								</div>
							)}
						</section>
					</div>
				</div>
			</div>
		</div>
	);
}
