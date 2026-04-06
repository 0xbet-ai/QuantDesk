import {
	Activity,
	Anchor,
	ArrowLeftRight,
	ArrowRight,
	BarChart3,
	Bot,
	Brain,
	CandlestickChart,
	Crosshair,
	FlaskConical,
	GitBranch,
	Grid3x3,
	Layers,
	LineChart,
	Maximize2,
	Repeat,
	Rocket,
	Scale,
	Scan,
	Search,
	Settings2,
	Shield,
	Sparkles,
	Store,
	Target,
	Timer,
	TrendingUp,
	Waves,
	X,
	Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import venues from "../../../strategies/venues.json";
import type { Strategy } from "../lib/api.js";
import { createDesk, listStrategies } from "../lib/api.js";
import { cn } from "../lib/utils.js";
import { DeskIcon } from "./icons/DeskIcon.js";
import { Badge } from "./ui/badge.js";
import { Button } from "./ui/button.js";
import { Input } from "./ui/input.js";
import { Textarea } from "./ui/textarea.js";

interface Props {
	onClose: () => void;
	onCreated: (deskId: string) => void;
}

type Step = "desk" | "venue" | "strategy" | "config" | "launch";

const categoryMeta: Record<string, { label: string; icon: typeof TrendingUp }> = {
	trend_following: { label: "Trend Following", icon: TrendingUp },
	mean_reversion: { label: "Mean Reversion", icon: ArrowLeftRight },
	momentum: { label: "Momentum", icon: Zap },
	ml_based: { label: "Machine Learning", icon: Brain },
	multi_indicator: { label: "Multi Indicator", icon: Layers },
	scalping: { label: "Scalping", icon: Timer },
	pattern: { label: "Pattern", icon: Scan },
	volatility: { label: "Volatility", icon: Activity },
	market_making: { label: "Market Making", icon: Scale },
	arbitrage: { label: "Arbitrage", icon: GitBranch },
	execution: { label: "Execution", icon: Target },
};

/** Per-strategy icon — gives each card a distinct visual.
 *  Falls back to the category icon when no override exists. */
const strategyIcons: Record<string, typeof TrendingUp> = {
	// freqtrade
	ft_strategy001: BarChart3,
	ft_strategy002: Waves,
	ft_strategy003: ArrowLeftRight,
	ft_strategy004: TrendingUp,
	ft_strategy005: Zap,
	ft_freqai_rl: Bot,
	ft_bandtastic: Waves,
	ft_supertrend: TrendingUp,
	ft_pattern_recognition: CandlestickChart,
	ft_godstra: Layers,
	ft_hlhb: LineChart,
	ft_adx_momentum: Zap,
	ft_bband_rsi: ArrowLeftRight,
	ft_combined_binh_cluc: GitBranch,
	ft_scalp: Timer,
	ft_td_sequential: CandlestickChart,
	ft_freqai_example: Brain,
	ft_freqai_hybrid: Brain,
	ft_f_supertrend: Maximize2,
	ft_volatility_system: Activity,
	ft_ott: LineChart,
	// nautilus
	nt_ema_cross: LineChart,
	nt_ema_cross_twap: Timer,
	nt_ema_bracket: Shield,
	nt_ema_trailing: Target,
	nt_market_maker: Scale,
	nt_orderbook_imbalance: BarChart3,
	nt_volatility_mm: Activity,
	nt_bb_mean_reversion: Waves,
	nt_ema_cross_long_only: TrendingUp,
	nt_ema_cross_stop_entry: Crosshair,
	nt_ema_cross_hedge_mode: Repeat,
	nt_grid_market_maker: Grid3x3,
	nt_simpler_quoter: Anchor,
	// hummingbot
	hb_pmm: Scale,
	hb_avellaneda: LineChart,
	hb_xemm: Repeat,
	hb_perpetual_mm: CandlestickChart,
	hb_amm_arb: GitBranch,
	hb_spot_perp_arb: ArrowLeftRight,
	hb_hedge: Shield,
	hb_liquidity_mining: Waves,
	hb_cross_exchange_mining: Grid3x3,
	hb_v2_funding_rate_arb: BarChart3,
	hb_simple_pmm: Anchor,
	hb_simple_vwap: Timer,
	hb_simple_xemm: Crosshair,
};

const stepTabs: { key: Step; label: string; icon: React.ComponentType<{ className?: string }> }[] =
	[
		{ key: "desk", label: "Desk", icon: DeskIcon },
		{ key: "venue", label: "Venue", icon: Store },
		{ key: "strategy", label: "Strategy", icon: FlaskConical },
		{ key: "config", label: "Config", icon: Settings2 },
		{ key: "launch", label: "Launch", icon: Rocket },
	];

const supportedEngines = new Set(venues.flatMap((v) => v.engines).filter((e) => e !== "generic"));

const allVenues = venues.filter((v) => v.engines.some((e) => supportedEngines.has(e)));

const venuesByType = {
	cex: allVenues.filter((v) => v.type === "cex"),
	dex: allVenues.filter((v) => v.type === "dex"),
	prediction: allVenues.filter((v) => v.type === "prediction"),
};

const venueTypeLabels: Record<string, string> = {
	cex: "Centralized Exchanges",
	dex: "Decentralized Exchanges",
	prediction: "Prediction Markets",
};

function venueName(id: string): string {
	return venues.find((v) => v.id === id)?.name ?? id;
}

export function CreateDeskWizard({ onClose, onCreated }: Props) {
	const [stepIndex, setStepIndex] = useState(0);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [customStrategyPrompt, setCustomStrategyPrompt] = useState("");
	const [selectedVenues, setSelectedVenues] = useState<string[]>([]);
	const [customVenue, setCustomVenue] = useState("");
	const [strategies, setStrategies] = useState<Strategy[]>([]);
	const [loadingStrategies, setLoadingStrategies] = useState(false);
	const [strategiesError, setStrategiesError] = useState<string | null>(null);
	const [selectedStrategyId, setSelectedStrategyId] = useState<string | null>(null); // null = nothing selected, "custom" = custom strategy
	const [strategySearch, setStrategySearch] = useState("");
	const [budget, setBudget] = useState("10000");
	const [targetReturn, setTargetReturn] = useState("15");
	const [stopLoss, setStopLoss] = useState("5");
	const [submitting, setSubmitting] = useState(false);
	const [submitError, setSubmitError] = useState<string | null>(null);

	const dialogRef = useRef<HTMLDialogElement>(null);
	const previousFocus = useRef<HTMLElement | null>(null);

	const step = stepTabs[stepIndex]!.key;

	// Focus trap & Escape handler
	useEffect(() => {
		previousFocus.current = document.activeElement as HTMLElement;

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onClose();
				return;
			}
			if (e.key === "Tab" && dialogRef.current) {
				const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
					'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
				);
				if (focusable.length === 0) return;
				const first = focusable[0]!;
				const last = focusable[focusable.length - 1]!;
				if (e.shiftKey && document.activeElement === first) {
					e.preventDefault();
					last.focus();
				} else if (!e.shiftKey && document.activeElement === last) {
					e.preventDefault();
					first.focus();
				}
			}
		};

		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("keydown", handleKeyDown);
			previousFocus.current?.focus();
		};
	}, [onClose]);

	// Load strategies
	useEffect(() => {
		if (step === "strategy" && strategies.length === 0 && !loadingStrategies) {
			setLoadingStrategies(true);
			setStrategiesError(null);
			listStrategies()
				.then(setStrategies)
				.catch((err: unknown) => {
					setStrategiesError(err instanceof Error ? err.message : "Failed to load strategies");
				})
				.finally(() => setLoadingStrategies(false));
		}
	}, [step, strategies.length, loadingStrategies]);

	const toggleVenue = (id: string) => {
		setSelectedVenues((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
	};

	const addCustomVenue = () => {
		const id = customVenue.trim().toLowerCase().replace(/\s+/g, "_");
		if (id && !selectedVenues.includes(id)) {
			setSelectedVenues((prev) => [...prev, id]);
		}
		setCustomVenue("");
	};

	// Filter strategies by engines available on selected venues
	const allowedEngines = new Set(
		selectedVenues.flatMap((vid) => venues.find((v) => v.id === vid)?.engines ?? []),
	);
	const engineFiltered =
		allowedEngines.size > 0 ? strategies.filter((s) => allowedEngines.has(s.engine)) : strategies;
	const searchLower = strategySearch.toLowerCase();
	const filteredStrategies = searchLower
		? engineFiltered.filter(
				(s) =>
					s.name.toLowerCase().includes(searchLower) ||
					s.description.toLowerCase().includes(searchLower) ||
					s.category.toLowerCase().includes(searchLower) ||
					s.indicators.some((ind) => ind.toLowerCase().includes(searchLower)),
			)
		: engineFiltered;

	// Clear strategy selection if it becomes invalid after venue change
	useEffect(() => {
		if (selectedStrategyId && !filteredStrategies.find((s) => s.id === selectedStrategyId)) {
			setSelectedStrategyId(null);
		}
	}, [selectedStrategyId, filteredStrategies]);

	const selectedStrategy = strategies.find((s) => s.id === selectedStrategyId);

	const handleSubmit = useCallback(async () => {
		setSubmitting(true);
		setSubmitError(null);
		try {
			const result = await createDesk({
				name,
				budget,
				targetReturn,
				stopLoss,
				venues: selectedVenues,
				engine: selectedStrategy?.engine ?? "generic",
				strategyId: selectedStrategyId === "custom" ? undefined : (selectedStrategyId ?? undefined),
				description: description || customStrategyPrompt || undefined,
			});
			onCreated(result.desk.id);
		} catch (err: unknown) {
			setSubmitError(err instanceof Error ? err.message : "Failed to create desk");
		} finally {
			setSubmitting(false);
		}
	}, [
		name,
		budget,
		targetReturn,
		stopLoss,
		selectedVenues,
		selectedStrategy,
		selectedStrategyId,
		description,
		customStrategyPrompt,
		onCreated,
	]);

	// Per-step validation
	const isStepValid = (s: Step): boolean => {
		switch (s) {
			case "desk":
				return name.trim().length > 0;
			case "venue":
				return selectedVenues.length > 0;
			case "config":
				return Number(budget) > 0 && Number(targetReturn) > 0 && Number(stopLoss) > 0;
			case "strategy":
				if (selectedStrategyId === null) return false;
				if (selectedStrategyId === "custom") return customStrategyPrompt.trim().length > 0;
				return true;
			case "launch":
				return true;
		}
	};

	const canProceed = isStepValid(step);
	const canLaunch = name.trim().length > 0 && selectedVenues.length > 0 && Number(budget) > 0;

	return (
		<dialog
			ref={dialogRef}
			open
			aria-modal="true"
			aria-label="Create new desk"
			className="fixed inset-0 z-50 bg-background flex flex-col w-full h-full max-w-none max-h-none m-0 p-0 border-none"
		>
			{/* Header */}
			<div className="shrink-0">
				<div className="max-w-3xl mx-auto w-full px-8">
					<div className="pt-6 pb-4">
						<Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close wizard">
							<X className="size-4" />
						</Button>
					</div>
					<div className="flex gap-1 border-b border-border">
						{stepTabs.map((tab, i) => {
							const Icon = tab.icon;
							return (
								<button
									key={tab.key}
									type="button"
									role="tab"
									aria-selected={i === stepIndex}
									aria-disabled={i > stepIndex}
									onClick={() => i <= stepIndex && setStepIndex(i)}
									className={cn(
										"flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors -mb-px whitespace-nowrap focus-visible:outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] rounded-t-sm",
										i === stepIndex
											? "border-foreground text-foreground"
											: i < stepIndex
												? "border-transparent text-muted-foreground hover:text-foreground cursor-pointer"
												: "border-transparent text-muted-foreground/40 cursor-default",
									)}
								>
									<Icon className="size-3.5" />
									{tab.label}
								</button>
							);
						})}
					</div>
				</div>
			</div>

			{/* Content */}
			<div className="flex-1 overflow-y-auto">
				<div className="max-w-3xl mx-auto w-full px-8 py-8">
					{step === "desk" && (
						<div className="space-y-8">
							<div className="flex items-center gap-3 mb-1">
								<DeskIcon className="size-5 text-foreground/60" />
								<div>
									<h3 className="text-sm font-semibold">Name your desk</h3>
									<p className="text-xs text-foreground/50">
										This is the workspace for your trading strategy.
									</p>
								</div>
							</div>
							<div className="space-y-4 max-w-sm">
								<div>
									<label htmlFor="desk-name" className="text-xs text-foreground/60 mb-1.5 block">
										Desk name
									</label>
									<Input
										id="desk-name"
										value={name}
										onChange={(e) => setName(e.target.value)}
										placeholder="BTC Trend Follow"
										autoFocus
									/>
								</div>
								<div>
									<label htmlFor="desk-desc" className="text-xs text-foreground/60 mb-1.5 block">
										Mission / goal (optional)
									</label>
									<Textarea
										id="desk-desc"
										value={description}
										onChange={(e) => setDescription(e.target.value)}
										rows={4}
										placeholder="What is this strategy trying to achieve?"
									/>
								</div>
							</div>
						</div>
					)}

					{step === "venue" && (
						<div className="space-y-8">
							<div className="flex items-center gap-3 mb-6">
								<Store className="size-5 text-foreground/60" />
								<div>
									<h3 className="text-sm font-semibold">Select venues</h3>
									<p className="text-xs text-foreground/50">
										Where do you trade? Select one or more. This cannot be changed later.
									</p>
								</div>
							</div>

							{(["cex", "dex", "prediction"] as const).map((type) =>
								venuesByType[type].length > 0 ? (
									<div key={type}>
										<div className="text-[10px] font-medium uppercase tracking-widest font-mono text-foreground/50 mb-2">
											{venueTypeLabels[type]}
										</div>
										<div className="flex flex-wrap gap-2">
											{venuesByType[type].map((v) => (
												<button
													key={v.id}
													type="button"
													aria-pressed={selectedVenues.includes(v.id)}
													onClick={() => toggleVenue(v.id)}
													className={cn(
														"px-3 py-1.5 rounded-md text-xs border transition-colors focus-visible:outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]",
														selectedVenues.includes(v.id)
															? "bg-primary text-primary-foreground border-primary"
															: "bg-card border-border dark:border-foreground/20 text-foreground hover:bg-accent",
													)}
												>
													{v.name}
												</button>
											))}
										</div>
									</div>
								) : null,
							)}

							<div className="max-w-xs">
								<div className="text-[10px] font-medium uppercase tracking-widest font-mono text-foreground/50 mb-2">
									Custom
								</div>
								<div className="flex gap-2">
									<Input
										id="custom-venue"
										aria-label="Custom venue name"
										value={customVenue}
										onChange={(e) => setCustomVenue(e.target.value)}
										onKeyDown={(e) => e.key === "Enter" && addCustomVenue()}
										placeholder="Add custom venue..."
										className="flex-1"
									/>
									<Button variant="outline" size="sm" onClick={addCustomVenue}>
										Add
									</Button>
								</div>
							</div>

							{selectedVenues.length > 0 && (
								<div className="flex flex-wrap gap-1">
									{selectedVenues.map((v) => (
										<Badge key={v} variant="secondary" className="gap-1">
											{venueName(v)}
											<button
												type="button"
												onClick={() => toggleVenue(v)}
												aria-label={`Remove ${venueName(v)}`}
												className="hover:text-destructive"
											>
												<X className="size-3" />
											</button>
										</Badge>
									))}
								</div>
							)}
						</div>
					)}

					{step === "strategy" &&
						(() => {
							if (loadingStrategies) {
								return (
									<div className="py-12 text-center text-sm text-muted-foreground">
										Loading strategies...
									</div>
								);
							}
							if (strategiesError) {
								return (
									<div className="py-12 text-center space-y-3">
										<p className="text-sm text-destructive">{strategiesError}</p>
										<Button
											variant="outline"
											size="sm"
											onClick={() => {
												setStrategiesError(null);
												setLoadingStrategies(false);
											}}
										>
											Retry
										</Button>
									</div>
								);
							}
							const categories = [...new Set(filteredStrategies.map((s) => s.category))];
							return (
								<div className="space-y-8">
									<div className="flex items-center gap-3">
										<FlaskConical className="size-5 text-foreground/60" />
										<div>
											<h3 className="text-sm font-semibold">Choose a strategy</h3>
											<p className="text-xs text-foreground/50">
												Pick from catalog or let the agent write one from scratch. This cannot be
												changed later.
											</p>
										</div>
									</div>

									{/* Search */}
									<div className="relative max-w-sm">
										<Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
										<Input
											value={strategySearch}
											onChange={(e) => setStrategySearch(e.target.value)}
											placeholder="Search strategies or indicators..."
											className="pl-9"
										/>
									</div>

									{/* Custom strategy — same grid card style */}
									{!strategySearch && (
										<div>
											<button
												type="button"
												aria-pressed={selectedStrategyId === "custom"}
												onClick={() => setSelectedStrategyId("custom")}
												className={cn(
													"text-left p-4 rounded-lg border transition-colors w-full focus-visible:outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]",
													selectedStrategyId === "custom"
														? "border-foreground bg-accent"
														: "border-border hover:bg-accent/50",
												)}
											>
												<div className="flex items-start gap-3">
													<div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted mt-0.5">
														<Sparkles className="size-4 text-foreground/70" />
													</div>
													<div className="min-w-0">
														<div className="text-[13px] font-medium text-foreground leading-tight">
															Custom Strategy
														</div>
														<div className="text-xs text-foreground/60 mt-1 line-clamp-2">
															Describe what you want and the agent writes the strategy code
														</div>
													</div>
												</div>
											</button>

											{selectedStrategyId === "custom" && (
												<div className="mt-3 max-w-md">
													<label
														htmlFor="strategy-prompt"
														className="text-xs text-muted-foreground mb-1.5 block"
													>
														Describe your strategy
													</label>
													<Textarea
														id="strategy-prompt"
														value={customStrategyPrompt}
														onChange={(e) => setCustomStrategyPrompt(e.target.value)}
														rows={3}
														placeholder="e.g. A momentum strategy that buys when RSI crosses above 30 and sells when it crosses below 70..."
														required
													/>
												</div>
											)}
										</div>
									)}

									{filteredStrategies.length === 0 && strategySearch && (
										<p className="text-[13px] text-muted-foreground py-6 text-center">
											No strategies match &ldquo;{strategySearch}&rdquo;
										</p>
									)}

									{/* Strategies grouped by category */}
									{categories.map((cat) => {
										const meta = categoryMeta[cat] ?? { label: cat, icon: FlaskConical };
										const CatIcon = meta.icon;
										const catStrategies = filteredStrategies.filter((s) => s.category === cat);
										return (
											<div key={cat}>
												<div className="flex items-center gap-1.5 mb-2">
													<CatIcon className="size-3.5 text-muted-foreground" />
													<span className="text-[10px] font-medium uppercase tracking-widest font-mono text-foreground/50">
														{meta.label}
													</span>
												</div>
												<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
													{catStrategies.map((s) => {
														const SIcon = strategyIcons[s.id] ?? CatIcon;
														const diffColor =
															s.difficulty === "easy"
																? "text-green-600 dark:text-green-400"
																: s.difficulty === "advanced"
																	? "text-orange-600 dark:text-orange-400"
																	: "text-blue-600 dark:text-blue-400";
														return (
															<button
																key={s.id}
																type="button"
																aria-pressed={selectedStrategyId === s.id}
																onClick={() => setSelectedStrategyId(s.id)}
																className={cn(
																	"text-left p-4 rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]",
																	selectedStrategyId === s.id
																		? "border-foreground bg-accent"
																		: "border-border dark:border-foreground/15 hover:bg-accent/50",
																)}
															>
																<div className="flex items-start gap-3">
																	<div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted mt-0.5">
																		<SIcon className="size-4 text-foreground/70" />
																	</div>
																	<div className="min-w-0">
																		<div className="text-[13px] font-medium text-foreground leading-tight">
																			{s.name}
																		</div>
																		<div className="text-xs text-foreground/60 mt-1 line-clamp-2">
																			{s.description}
																		</div>
																		<div className={cn("text-[11px] mt-2 font-medium", diffColor)}>
																			{s.difficulty}
																		</div>
																	</div>
																</div>
															</button>
														);
													})}
												</div>
											</div>
										);
									})}
								</div>
							);
						})()}

					{step === "config" && (
						<div className="space-y-8">
							<div className="flex items-center gap-3 mb-1">
								<Settings2 className="size-5 text-foreground/60" />
								<div>
									<h3 className="text-sm font-semibold">Configure constraints</h3>
									<p className="text-xs text-foreground/50">
										Set budget and risk parameters for this desk.
									</p>
								</div>
							</div>

							<div className="space-y-4 max-w-xs">
								<div>
									<label htmlFor="cfg-budget" className="text-xs text-foreground/60 mb-1.5 block">
										Budget (USD)
									</label>
									<Input
										id="cfg-budget"
										inputMode="numeric"
										value={Number(budget).toLocaleString("en-US")}
										onChange={(e) => {
											const raw = e.target.value.replace(/,/g, "");
											if (/^\d*$/.test(raw)) setBudget(raw);
										}}
									/>
								</div>
								<div>
									<label htmlFor="cfg-target" className="text-xs text-foreground/60 mb-1.5 block">
										Target return %
									</label>
									<Input
										id="cfg-target"
										type="number"
										min="0.1"
										step="0.1"
										value={targetReturn}
										onChange={(e) => setTargetReturn(e.target.value)}
									/>
								</div>
								<div>
									<label htmlFor="cfg-stoploss" className="text-xs text-foreground/60 mb-1.5 block">
										Stop loss % (max drawdown)
									</label>
									<Input
										id="cfg-stoploss"
										type="number"
										min="0.1"
										step="0.1"
										value={stopLoss}
										onChange={(e) => setStopLoss(e.target.value)}
									/>
								</div>
							</div>
						</div>
					)}

					{step === "launch" && (
						<div className="space-y-8">
							<div className="flex items-center gap-3 mb-1">
								<Rocket className="size-5 text-foreground/60" />
								<div>
									<h3 className="text-sm font-semibold">Review and launch</h3>
									<p className="text-xs text-foreground/50">Confirm your desk configuration.</p>
								</div>
							</div>

							<div className="max-w-sm space-y-3">
								<div className="flex justify-between text-[13px]">
									<span className="text-foreground/50">Desk</span>
									<span className="font-medium">{name}</span>
								</div>
								<div className="flex justify-between text-[13px]">
									<span className="text-foreground/50">Venues</span>
									<div className="flex gap-1 flex-wrap justify-end">
										{selectedVenues.map((v) => (
											<Badge key={v} variant="secondary" className="text-[10px]">
												{venueName(v)}
											</Badge>
										))}
										{selectedVenues.length === 0 && (
											<span className="text-foreground/40">none</span>
										)}
									</div>
								</div>
								<div className="flex justify-between text-[13px]">
									<span className="text-foreground/50">Strategy</span>
									<span className="font-medium">
										{selectedStrategyId === "custom" ? "Custom" : (selectedStrategy?.name ?? "---")}
									</span>
								</div>
								<div className="flex justify-between text-[13px]">
									<span className="text-foreground/50">Budget</span>
									<span className="font-medium">${Number(budget).toLocaleString("en-US")}</span>
								</div>
								<div className="flex justify-between text-[13px]">
									<span className="text-foreground/50">Target</span>
									<span className="font-medium text-green-600 dark:text-green-400">
										+{targetReturn}%
									</span>
								</div>
								<div className="flex justify-between text-[13px]">
									<span className="text-foreground/50">Stop loss</span>
									<span className="font-medium text-destructive">-{stopLoss}%</span>
								</div>
							</div>

							{submitError && (
								<div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
									{submitError}
								</div>
							)}
						</div>
					)}
				</div>
			</div>

			{/* Footer */}
			<div className="shrink-0 border-t border-border">
				<div className="max-w-3xl mx-auto w-full flex justify-end px-8 py-4">
					{step === "launch" ? (
						<Button onClick={handleSubmit} disabled={submitting || !canLaunch} className="gap-1.5">
							<Rocket className="size-4" />
							{submitting ? "Creating..." : "Launch"}
						</Button>
					) : (
						<Button
							onClick={() => setStepIndex(stepIndex + 1)}
							disabled={!canProceed}
							className="gap-1.5"
						>
							<ArrowRight className="size-4" />
							Next
						</Button>
					)}
				</div>
			</div>
		</dialog>
	);
}
