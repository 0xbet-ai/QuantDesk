import { type VenueEngines, availableModesForVenues, engineForMode } from "@quantdesk/shared";
import {
	Activity,
	Anchor,
	ArrowLeft,
	ArrowLeftRight,
	ArrowRight,
	BarChart3,
	Bitcoin,
	Bot,
	Brain,
	Briefcase,
	CandlestickChart,
	Code2,
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
	Trophy,
	Waves,
	X,
	Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import venues from "../../../strategies/venues.json";
import type { Strategy, StrategyMode } from "../lib/api.js";
import { createDesk, listStrategies } from "../lib/api.js";
import { cn } from "../lib/utils.js";
import { FolderPickerModal } from "./FolderPickerModal.js";
import { StrategyAnimation } from "./StrategyAnimation.js";
import { DeskIcon } from "./icons/DeskIcon.js";
import { Badge } from "./ui/badge.js";
import { Button } from "./ui/button.js";
import { Input } from "./ui/input.js";
import { Textarea } from "./ui/textarea.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip.js";

interface Props {
	onClose: () => void;
	onCreated: (deskId: string, experimentId: string) => void;
}

type Step = "desk" | "market" | "venue" | "mode" | "strategy" | "agent" | "config" | "launch";
type AssetClass = "crypto" | "stocks" | "fx" | "commodities" | "prediction";

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
};

const stepTabs: { key: Step; label: string; icon: React.ComponentType<{ className?: string }> }[] =
	[
		{ key: "desk", label: "Desk", icon: DeskIcon },
		{ key: "market", label: "Market", icon: Layers },
		{ key: "venue", label: "Venue", icon: Store },
		{ key: "mode", label: "Mode", icon: Zap },
		{ key: "strategy", label: "Strategy", icon: FlaskConical },
		{ key: "agent", label: "Agent", icon: Bot },
		{ key: "config", label: "Config", icon: Settings2 },
		{ key: "launch", label: "Launch", icon: Rocket },
	];

// Intersect strategy modes supported across the selected venues. Custom
// venues (not in venues.json) are permissive — both modes available. The
// underlying engine name resolution lives in `@quantdesk/shared/venue-modes`
// so the UI never has to know which engine backs which mode.
function computeAvailableModes(selectedVenueIds: string[]): StrategyMode[] {
	if (selectedVenueIds.length === 0) return [];
	const resolved: VenueEngines[] = [];
	for (const id of selectedVenueIds) {
		const v = venues.find((x) => x.id === id);
		if (v) {
			resolved.push(v as VenueEngines);
		} else {
			// Custom venue placeholder. Mode selection is permissive
			// because resolveEngine now falls back to the generic engine
			// whenever the preferred managed engine isn't available for
			// the venue, so the user can always pick either mode.
			resolved.push({ id, name: id, engines: [] });
		}
	}
	return availableModesForVenues(resolved);
}

const ASSET_CLASS_META: {
	id: AssetClass;
	label: string;
	description: string;
	icon: typeof Bitcoin;
	enabled: boolean;
}[] = [
	{
		id: "crypto",
		label: "Crypto",
		description: "Bitcoin, altcoins, perps, on-chain DEXes",
		icon: Bitcoin,
		enabled: true,
	},
	{
		id: "stocks",
		label: "Stocks",
		description: "US equities, options via Interactive Brokers",
		icon: TrendingUp,
		enabled: false,
	},
	{
		id: "prediction",
		label: "Prediction Markets",
		description: "Polymarket — yes/no outcomes",
		icon: Trophy,
		enabled: true,
	},
	{
		id: "fx",
		label: "FX",
		description: "Currency pairs (coming soon)",
		icon: ArrowLeftRight,
		enabled: false,
	},
	{
		id: "commodities",
		label: "Commodities",
		description: "Gold, oil, agricultural (coming soon)",
		icon: Briefcase,
		enabled: false,
	},
];

// Every venue in the catalog is shown — managed venues (freqtrade /
// nautilus) and generic-only venues (Kalshi etc.) alike. The wizard's
// mode picker filters per-venue via `availableModes`.
const allVenues = venues;

// Venue type ordering used inside the Venue step (after a market is picked).
const TYPE_ORDER = ["cex", "dex", "broker"] as const;

const assetClassLabels: Record<string, string> = {
	crypto: "Crypto",
	stocks: "Stocks",
	fx: "FX",
	commodities: "Commodities",
	prediction: "Prediction Markets",
};

const venueTypeLabels: Record<string, string> = {
	cex: "Centralized",
	dex: "Decentralized",
	broker: "Brokers",
};

const venuesByAssetClass: Record<string, Record<string, typeof allVenues>> = {};
for (const v of allVenues) {
	const ac = v.assetClass ?? "crypto";
	const t = v.type;
	if (!venuesByAssetClass[ac]) venuesByAssetClass[ac] = {};
	if (!venuesByAssetClass[ac][t]) venuesByAssetClass[ac][t] = [];
	venuesByAssetClass[ac][t].push(v);
}

function venueName(id: string): string {
	return venues.find((v) => v.id === id)?.name ?? id;
}

export function CreateDeskWizard({ onClose, onCreated }: Props) {
	const [stepIndex, setStepIndex] = useState(0);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [customStrategyPrompt, setCustomStrategyPrompt] = useState("");
	// Workspace bootstrap (phase 09 / 10) — only meaningful for Custom Strategy.
	// Both fields are optional. seedCodePath is an absolute host directory whose
	// contents are copied into the desk workspace at creation; externalMounts
	// are bind-mounted read-only into /workspace/data/external/<label> at every
	// container spawn.
	const [seedCodePath, setSeedCodePath] = useState("");
	const [externalMounts, setExternalMounts] = useState<Array<{ label: string; hostPath: string }>>(
		[],
	);
	// Folder picker modal state. `null` = closed; otherwise an object describing
	// what to do with the picked path. Same modal serves both seed code and any
	// external-mount row, keyed by index.
	const [folderPicker, setFolderPicker] = useState<
		null | { kind: "seed" } | { kind: "mount"; index: number }
	>(null);
	const [selectedAssetClass, setSelectedAssetClass] = useState<AssetClass>("crypto");
	const [selectedVenues, setSelectedVenues] = useState<string[]>([]);
	const [selectedMode, setSelectedMode] = useState<StrategyMode | null>(null);
	const [customVenue, setCustomVenue] = useState("");
	const [strategies, setStrategies] = useState<Strategy[]>([]);
	const [loadingStrategies, setLoadingStrategies] = useState(false);
	const [strategiesError, setStrategiesError] = useState<string | null>(null);
	const [selectedStrategyId, setSelectedStrategyId] = useState<string>("custom"); // "custom" = agent writes from scratch
	const [strategySearch, setStrategySearch] = useState("");
	const [budget, setBudget] = useState("10000");
	const [targetReturn, setTargetReturn] = useState("15");
	const [stopLoss, setStopLoss] = useState("5");
	const [adapterType, setAdapterType] = useState<"claude" | "codex">("claude");
	const [adapterModel, setAdapterModel] = useState("default");
	const [adapterTesting, setAdapterTesting] = useState(false);
	const [adapterTestResult, setAdapterTestResult] = useState<"success" | "error" | null>(null);
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

	// Filter strategies by engine resolved from the selected mode
	// (falls back to any engine available on the selected venues when mode is not yet picked).
	const allowedEngines = new Set<string>();
	if (selectedMode) {
		allowedEngines.add(engineForMode(selectedMode));
	} else {
		for (const vid of selectedVenues) {
			const v = venues.find((x) => x.id === vid);
			for (const e of v?.engines ?? []) allowedEngines.add(e);
		}
	}
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
		if (
			selectedStrategyId !== "custom" &&
			!filteredStrategies.find((s) => s.id === selectedStrategyId)
		) {
			setSelectedStrategyId("custom");
		}
	}, [selectedStrategyId, filteredStrategies]);

	const selectedStrategy = strategies.find((s) => s.id === selectedStrategyId);

	const handleSubmit = useCallback(async () => {
		setSubmitting(true);
		setSubmitError(null);
		try {
			if (!selectedMode) {
				throw new Error("Strategy mode not selected");
			}
			// Workspace bootstrap fields are only sent for the Custom Strategy
			// path. Server-side validation rejects bad paths fast.
			const cleanedMounts = externalMounts
				.map((m) => ({ label: m.label.trim(), hostPath: m.hostPath.trim() }))
				.filter((m) => m.label.length > 0 && m.hostPath.length > 0);
			const isCustom = selectedStrategyId === "custom";
			const result = await createDesk({
				name,
				budget,
				targetReturn,
				stopLoss,
				venues: selectedVenues,
				strategyMode: selectedMode,
				strategyId: selectedStrategyId === "custom" ? undefined : (selectedStrategyId ?? undefined),
				description: description || customStrategyPrompt || undefined,
				adapterType,
				adapterConfig: adapterModel !== "default" ? { model: adapterModel } : {},
				seedCodePath: isCustom && seedCodePath.trim() ? seedCodePath.trim() : undefined,
				externalMounts: isCustom && cleanedMounts.length > 0 ? cleanedMounts : undefined,
			});
			onCreated(result.desk.id, result.experiment.id);
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
		selectedMode,
		selectedStrategyId,
		description,
		customStrategyPrompt,
		adapterType,
		adapterModel,
		seedCodePath,
		externalMounts,
		onCreated,
	]);

	const availableModes = computeAvailableModes(selectedVenues);

	// Auto-pick the only available mode and clear an invalid selection when venues change.
	useEffect(() => {
		if (availableModes.length === 1 && selectedMode !== availableModes[0]) {
			setSelectedMode(availableModes[0]!);
		} else if (
			selectedMode &&
			availableModes.length > 0 &&
			!availableModes.includes(selectedMode)
		) {
			setSelectedMode(null);
		}
	}, [availableModes, selectedMode]);

	// Per-step validation
	const isStepValid = (s: Step): boolean => {
		switch (s) {
			case "desk":
				return name.trim().length > 0 && description.trim().length >= 10;
			case "market":
				return selectedAssetClass !== undefined;
			case "venue":
				return selectedVenues.length > 0;
			case "mode":
				return selectedMode !== null && availableModes.includes(selectedMode);
			case "config":
				return Number(budget) > 0 && Number(targetReturn) > 0 && Number(stopLoss) > 0;
			case "strategy":
				if (selectedStrategyId === "custom") return customStrategyPrompt.trim().length > 0;
				return selectedStrategyId.length > 0;
			case "agent":
				return true;
			case "launch":
				return true;
		}
	};

	const canProceed = isStepValid(step);
	const canLaunch = name.trim().length > 0 && selectedVenues.length > 0 && Number(budget) > 0;

	return (
		<>
			<dialog
				ref={dialogRef}
				open
				aria-modal="true"
				aria-label="Create new desk"
				className="fixed inset-0 z-50 bg-background flex flex-col w-full h-full max-w-none max-h-none m-0 p-0 border-none"
			>
				{/* Header */}
				<div className="shrink-0">
					{/* X close — top left */}
					<div className="px-6 pt-6 pb-2">
						<Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close wizard">
							<X className="size-4" />
						</Button>
					</div>
					{/* Tabs — centered */}
					<div className="max-w-2xl mx-auto w-full px-8">
						<div className="flex justify-center gap-1 border-b border-border">
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
					<div className="max-w-2xl mx-auto w-full px-8 py-8">
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
											Mission / goal <span className="text-red-500">*</span>
										</label>
										<Textarea
											id="desk-desc"
											value={description}
											onChange={(e) => setDescription(e.target.value)}
											rows={4}
											placeholder="What is this strategy trying to achieve? (write in the language you want the agent to reply in)"
										/>
										<p className="text-[11px] text-foreground/40 mt-1">
											Minimum 10 characters. The agent matches its response language to this description on the first turn.
										</p>
									</div>
								</div>
							</div>
						)}

						{step === "market" && (
							<div className="space-y-6">
								<div className="flex items-center gap-3 mb-2">
									<Layers className="size-5 text-foreground/60" />
									<div>
										<h3 className="text-sm font-semibold">Pick a market</h3>
										<p className="text-xs text-foreground/50">
											What asset class do you want to trade? You can change venues later, but not
											the market.
										</p>
									</div>
								</div>

								<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
									{ASSET_CLASS_META.map((m) => {
										const Icon = m.icon;
										const selected = selectedAssetClass === m.id;
										return (
											<button
												key={m.id}
												type="button"
												disabled={!m.enabled}
												aria-pressed={selected}
												onClick={() => {
													if (!m.enabled) return;
													if (m.id !== selectedAssetClass) {
														setSelectedAssetClass(m.id);
														setSelectedVenues([]);
													}
												}}
												className={cn(
													"flex flex-col items-start gap-3 p-4 rounded-lg border text-left transition-all",
													"focus-visible:outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]",
													selected
														? "border-primary bg-primary/5 ring-1 ring-primary"
														: "border-border bg-card hover:bg-accent hover:border-foreground/30",
													!m.enabled &&
														"opacity-40 cursor-not-allowed hover:bg-card hover:border-border",
												)}
											>
												<div
													className={cn(
														"flex size-10 items-center justify-center rounded-md",
														selected
															? "bg-primary text-primary-foreground"
															: "bg-muted text-foreground/70",
													)}
												>
													<Icon className="size-5" />
												</div>
												<div className="space-y-0.5">
													<div className="text-sm font-semibold text-foreground flex items-center gap-2">
														{m.label}
														{!m.enabled && (
															<span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
																Soon
															</span>
														)}
													</div>
													<div className="text-xs text-foreground/60 leading-snug">
														{m.description}
													</div>
												</div>
											</button>
										);
									})}
								</div>
							</div>
						)}

						{step === "venue" && (
							<div className="space-y-8">
								<div className="flex items-center gap-3 mb-6">
									<Store className="size-5 text-foreground/60" />
									<div>
										<h3 className="text-sm font-semibold">
											Select venues — {assetClassLabels[selectedAssetClass] ?? selectedAssetClass}
										</h3>
										<p className="text-xs text-foreground/50">
											Where do you trade? Select one or more. This cannot be changed later.
										</p>
									</div>
								</div>

								{(() => {
									const byType = venuesByAssetClass[selectedAssetClass];
									if (!byType) {
										return (
											<div className="text-xs text-foreground/50">
												No venues available for this market yet.
											</div>
										);
									}
									return TYPE_ORDER.map((type) => {
										const list = byType[type];
										if (!list || list.length === 0) return null;
										return (
											<div key={`${selectedAssetClass}-${type}`}>
												<div className="text-[10px] font-medium uppercase tracking-widest font-mono text-foreground/50 mb-2">
													{venueTypeLabels[type]}
												</div>
												<div className="flex flex-wrap gap-2">
													{list.map((v) => (
														<Tooltip key={v.id}>
															<TooltipTrigger asChild>
																<button
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
															</TooltipTrigger>
															{v.url && (
																<TooltipContent side="bottom">
																	{v.url.replace("https://", "")}
																</TooltipContent>
															)}
														</Tooltip>
													))}
												</div>
											</div>
										);
									});
								})()}

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
											placeholder="e.g. Uniswap (Base)"
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

						{step === "mode" && (
							<div className="space-y-4">
								<div>
									<h3 className="text-sm font-medium">How should the strategy behave?</h3>
									<p className="text-xs text-muted-foreground">
										Classic runs on candles (TA, indicators, minute-to-hour). Real-time reacts to
										every tick and order book update. Cards disabled for the selected venues are not
										available.
									</p>
								</div>
								<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
									{(["classic", "realtime"] as const).map((mode) => {
										const enabled = availableModes.includes(mode);
										const active = selectedMode === mode;
										const title = mode === "classic" ? "Classic" : "Real-time";
										const tag = mode === "classic" ? "Recommended" : "Advanced";
										const desc =
											mode === "classic"
												? "Candle-based polling strategies. TA indicators, trend following, mean reversion, momentum. Minute to hour timeframes."
												: "Event-driven strategies reacting to ticks and order book deltas. Market making, arbitrage, HFT. Sub-second timeframes.";
										const Icon = mode === "classic" ? BarChart3 : Zap;
										return (
											<button
												key={mode}
												type="button"
												disabled={!enabled}
												onClick={() => enabled && setSelectedMode(mode)}
												className={cn(
													"flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition",
													enabled
														? "hover:border-primary hover:bg-accent cursor-pointer"
														: "cursor-not-allowed opacity-40",
													active && "border-primary bg-accent",
												)}
											>
												<div className="flex w-full items-center justify-between">
													<div className="flex items-center gap-2">
														<Icon className="h-4 w-4" />
														<span className="font-medium">{title}</span>
													</div>
													<Badge variant="outline" className="text-[10px]">
														{tag}
													</Badge>
												</div>
												<p className="text-xs text-muted-foreground">{desc}</p>
												{!enabled && (
													<p className="text-[11px] text-muted-foreground italic">
														Not available for the selected venues.
													</p>
												)}
											</button>
										);
									})}
								</div>
								{availableModes.length === 0 && selectedVenues.length > 0 && (
									<p className="text-xs text-destructive">
										The selected venues have no managed strategy mode. Paper trading will not be
										available — pick different venues to enable Classic or Real-time.
									</p>
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
								const detailStrategy =
									selectedStrategyId && selectedStrategyId !== "custom"
										? (filteredStrategies.find((s) => s.id === selectedStrategyId) ?? null)
										: null;
								const DetailIcon = detailStrategy
									? (strategyIcons[detailStrategy.id] ??
										categoryMeta[detailStrategy.category]?.icon ??
										FlaskConical)
									: null;
								return (
									<div className="flex gap-6">
										{/* Left: strategy list */}
										<div
											className={cn(
												"space-y-6 overflow-y-auto transition-all duration-300",
												detailStrategy || selectedStrategyId === "custom"
													? "w-[55%] shrink-0"
													: "w-full",
											)}
										>
											<div className="flex items-center gap-3">
												<FlaskConical className="size-5 text-foreground/60" />
												<div>
													<h3 className="text-sm font-semibold">Choose a strategy</h3>
													<p className="text-xs text-foreground/50">
														Pick from catalog or let the agent write one from scratch.
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

											{/* Custom strategy */}
											{!strategySearch && (
												<button
													type="button"
													aria-pressed={selectedStrategyId === "custom"}
													onClick={() => setSelectedStrategyId("custom")}
													className={cn(
														"text-left p-3 rounded-lg border transition-colors w-full focus-visible:outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]",
														selectedStrategyId === "custom"
															? "border-foreground bg-accent"
															: "border-border hover:bg-accent/50",
													)}
												>
													<div className="flex items-center gap-3">
														<div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
															<Sparkles className="size-3.5 text-foreground/70" />
														</div>
														<div className="min-w-0">
															<div className="text-[13px] font-medium text-foreground">
																Custom Strategy
															</div>
															<div className="text-[11px] text-foreground/50">
																Agent writes from your description
															</div>
														</div>
													</div>
												</button>
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
														<div className="flex items-center gap-1.5 mb-1.5">
															<CatIcon className="size-3 text-muted-foreground" />
															<span className="text-[10px] font-medium uppercase tracking-widest font-mono text-foreground/50">
																{meta.label}
															</span>
														</div>
														<div className="space-y-1.5">
															{catStrategies.map((s) => {
																const SIcon = strategyIcons[s.id] ?? CatIcon;
																const isActive = selectedStrategyId === s.id;
																return (
																	<button
																		key={s.id}
																		type="button"
																		aria-pressed={isActive}
																		onClick={() => setSelectedStrategyId(s.id)}
																		className={cn(
																			"flex items-center gap-3 w-full text-left px-3 py-2.5 rounded-lg border transition-all duration-200 focus-visible:outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]",
																			isActive
																				? "border-foreground bg-accent shadow-sm"
																				: "border-border dark:border-foreground/15 hover:bg-accent/50",
																		)}
																	>
																		<div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
																			<SIcon className="size-3.5 text-foreground/70" />
																		</div>
																		<div className="min-w-0 flex-1">
																			<div className="text-[13px] font-medium text-foreground leading-tight">
																				{s.name}
																			</div>
																			<div className="text-[11px] text-foreground/50 truncate">
																				{s.summary ?? s.description}
																			</div>
																		</div>
																		<div
																			className={cn(
																				"text-[10px] font-medium shrink-0",
																				s.difficulty === "easy"
																					? "text-green-600 dark:text-green-400"
																					: s.difficulty === "advanced"
																						? "text-orange-600 dark:text-orange-400"
																						: "text-blue-600 dark:text-blue-400",
																			)}
																		>
																			{s.difficulty}
																		</div>
																	</button>
																);
															})}
														</div>
													</div>
												);
											})}
										</div>

										{/* Right: detail panel */}
										{detailStrategy && DetailIcon && (
											<div className="w-[45%] shrink-0 animate-in fade-in slide-in-from-right-4 duration-300">
												<div className="sticky top-4 rounded-xl border border-border bg-background p-5 space-y-4 shadow-sm">
													{/* Header */}
													<div className="flex items-start gap-3">
														<div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
															<DetailIcon className="size-5 text-foreground/70" />
														</div>
														<div className="min-w-0">
															<div className="text-sm font-semibold">{detailStrategy.name}</div>
															<div className="flex items-center gap-2 mt-1">
																<Badge variant="secondary" className="text-[10px]">
																	{categoryMeta[detailStrategy.category]?.label ??
																		detailStrategy.category}
																</Badge>
																<Badge
																	variant="outline"
																	className={cn(
																		"text-[10px]",
																		detailStrategy.difficulty === "easy"
																			? "text-green-600 border-green-500/30 dark:text-green-400"
																			: detailStrategy.difficulty === "advanced"
																				? "text-orange-600 border-orange-500/30 dark:text-orange-400"
																				: "text-blue-600 border-blue-500/30 dark:text-blue-400",
																	)}
																>
																	{detailStrategy.difficulty}
																</Badge>
															</div>
														</div>
													</div>

													{/* Animation */}
													<div key={detailStrategy.id} className="text-foreground">
														<StrategyAnimation category={detailStrategy.category} />
													</div>

													{/* Summary + Description */}
													{detailStrategy.summary && (
														<div className="text-[13px] font-medium text-foreground/90 leading-relaxed">
															{detailStrategy.summary}
														</div>
													)}
													<div className="text-xs text-foreground/60 leading-relaxed">
														{detailStrategy.description}
													</div>

													{/* Indicators */}
													{detailStrategy.indicators.length > 0 && (
														<div>
															<div className="text-[10px] font-medium uppercase tracking-widest text-foreground/40 mb-1.5">
																Indicators
															</div>
															<div className="flex flex-wrap gap-1.5">
																{detailStrategy.indicators.map((ind) => (
																	<Badge
																		key={ind}
																		variant="outline"
																		className="text-[11px] font-mono"
																	>
																		{ind}
																	</Badge>
																))}
															</div>
														</div>
													)}

													{/* Timeframes */}
													<div>
														<div className="text-[10px] font-medium uppercase tracking-widest text-foreground/40 mb-1.5">
															Timeframes <span className="text-foreground/30 normal-case tracking-normal">(Recommend)</span>
														</div>
														<div className="flex flex-wrap gap-1.5">
															{detailStrategy.timeframes.map((tf) => (
																<Badge
																	key={tf}
																	variant="secondary"
																	className="text-[11px] font-mono"
																>
																	{tf}
																</Badge>
															))}
														</div>
													</div>

													{/* Source link */}
													{detailStrategy.source && (
														<a
															href={detailStrategy.source}
															target="_blank"
															rel="noreferrer"
															className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
														>
															View source ↗
														</a>
													)}
												</div>
											</div>
										)}

										{/* Right: custom strategy detail */}
										{selectedStrategyId === "custom" && (
											<div className="w-[45%] shrink-0 animate-in fade-in slide-in-from-right-4 duration-300">
												<div className="sticky top-4 rounded-xl border border-border bg-background p-5 space-y-4 shadow-sm">
													<div className="flex items-start gap-3">
														<div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
															<Sparkles className="size-5 text-foreground/70" />
														</div>
														<div>
															<div className="text-sm font-semibold">Custom Strategy</div>
															<div className="text-xs text-foreground/50 mt-0.5">
																The agent will write strategy code based on your description
															</div>
														</div>
													</div>
													<div>
														<label
															htmlFor="strategy-prompt"
															className="text-[10px] font-medium uppercase tracking-widest text-foreground/40 mb-1.5 block"
														>
															Your description
														</label>
														<Textarea
															id="strategy-prompt"
															value={customStrategyPrompt}
															onChange={(e) => setCustomStrategyPrompt(e.target.value)}
															rows={10}
															className="min-h-[200px] resize-y"
															placeholder="e.g. A momentum strategy that buys when RSI crosses above 30 and sells when it crosses below 70. Use a 14-period RSI on 1h candles. Add a stop-loss at 2% and take-profit at 5%. Trade only during high-volume hours..."
															required
														/>
													</div>

													{/* Workspace bootstrap (phase 09 / 10) — both fields are
												    optional. Surface them only on the Custom Strategy
												    path, where the user is most likely to start from
												    something local. Server-side validation rejects bad
												    paths before the desk row is written. */}
													<div className="border-t border-border pt-4">
														<div className="text-[10px] font-medium uppercase tracking-widest text-foreground/40 mb-2">
															Bring your own (optional)
														</div>
														<div className="space-y-3">
															<div>
																<label
																	htmlFor="seed-code-path"
																	className="text-xs font-medium text-foreground/70 mb-1 block"
																>
																	Seed code directory
																</label>
																<div className="flex items-center gap-1.5">
																	<input
																		id="seed-code-path"
																		type="text"
																		value={seedCodePath}
																		onChange={(e) => setSeedCodePath(e.target.value)}
																		placeholder="/Users/you/strategies/my_mm"
																		className="min-w-0 flex-1 px-2.5 py-1.5 text-[11px] font-mono rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-foreground/30"
																	/>
																	<button
																		type="button"
																		onClick={() => setFolderPicker({ kind: "seed" })}
																		className="shrink-0 px-2 py-1.5 text-[11px] rounded-md border border-border bg-background hover:bg-accent transition-colors"
																	>
																		Browse
																	</button>
																</div>
																<div className="text-[10px] text-foreground/40 mt-1">
																	Contents are copied into the desk workspace at creation.
																</div>
															</div>

															<div>
																<div className="flex items-center justify-between mb-1">
																	<span className="text-xs font-medium text-foreground/70">
																		External datasets
																	</span>
																	<button
																		type="button"
																		onClick={() =>
																			setExternalMounts((prev) => [
																				...prev,
																				{ label: "", hostPath: "" },
																			])
																		}
																		className="text-[11px] text-foreground/60 hover:text-foreground transition-colors"
																	>
																		+ Add
																	</button>
																</div>
																{externalMounts.length === 0 ? (
																	<div className="text-[10px] text-foreground/40">
																		Bind-mount existing local data into{" "}
																		<code className="font-mono">
																			/workspace/data/external/&lt;label&gt;
																		</code>{" "}
																		(read-only).
																	</div>
																) : (
																	<div className="space-y-2.5">
																		{externalMounts.map((m, i) => (
																			<div
																				// biome-ignore lint/suspicious/noArrayIndexKey: row identity is positional in this small editable list
																				key={i}
																				className="rounded-md border border-border bg-muted/30 p-2 space-y-1.5"
																			>
																				<div className="flex items-center gap-1.5">
																					<input
																						type="text"
																						value={m.label}
																						onChange={(e) =>
																							setExternalMounts((prev) =>
																								prev.map((row, idx) =>
																									idx === i
																										? { ...row, label: e.target.value }
																										: row,
																								),
																							)
																						}
																						placeholder="label"
																						className="min-w-0 flex-1 px-2 py-1 text-[11px] font-mono rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-foreground/30"
																					/>
																					<button
																						type="button"
																						onClick={() =>
																							setExternalMounts((prev) =>
																								prev.filter((_, idx) => idx !== i),
																							)
																						}
																						className="shrink-0 text-foreground/40 hover:text-foreground/80 transition-colors px-1"
																						aria-label="remove mount"
																					>
																						×
																					</button>
																				</div>
																				<div className="flex items-center gap-1.5">
																					<input
																						type="text"
																						value={m.hostPath}
																						onChange={(e) =>
																							setExternalMounts((prev) =>
																								prev.map((row, idx) =>
																									idx === i
																										? { ...row, hostPath: e.target.value }
																										: row,
																								),
																							)
																						}
																						placeholder="/abs/path/to/data"
																						className="min-w-0 flex-1 px-2 py-1 text-[11px] font-mono rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-foreground/30"
																					/>
																					<button
																						type="button"
																						onClick={() =>
																							setFolderPicker({ kind: "mount", index: i })
																						}
																						className="shrink-0 px-2 py-1 text-[10px] rounded-md border border-border bg-background hover:bg-accent transition-colors"
																					>
																						Browse
																					</button>
																				</div>
																			</div>
																		))}
																	</div>
																)}
															</div>
														</div>
													</div>
												</div>
											</div>
										)}
									</div>
								);
							})()}

						{step === "agent" && (
							<div className="space-y-8">
								<div className="flex items-center gap-3 mb-1">
									<Bot className="size-5 text-foreground/60" />
									<div>
										<h3 className="text-sm font-semibold">Configure agent</h3>
										<p className="text-xs text-foreground/50">
											Choose how the AI agent will run tasks for this desk.
										</p>
									</div>
								</div>

								<div className="space-y-4 max-w-md">
									<div>
										<label className="text-xs text-foreground/60 mb-2 block">Adapter type</label>
										<div className="grid grid-cols-2 gap-3">
											<button
												type="button"
												onClick={() => setAdapterType("claude")}
												className={cn(
													"relative p-4 rounded-lg border text-center transition-colors",
													adapterType === "claude"
														? "border-foreground bg-accent"
														: "border-border hover:bg-accent/50",
												)}
											>
												{adapterType === "claude" && (
													<span className="absolute -top-2 left-1/2 -translate-x-1/2 px-1.5 py-0.5 text-[10px] font-medium bg-green-500 text-white rounded-full">
														Selected
													</span>
												)}
												<Sparkles className="size-5 mx-auto mb-2 text-foreground/70" />
												<div className="text-[13px] font-medium">Claude Code</div>
												<div className="text-[11px] text-muted-foreground mt-0.5">
													Local Claude agent
												</div>
											</button>
											<button
												type="button"
												disabled
												aria-disabled="true"
												title="Codex adapter is temporarily disabled"
												className={cn(
													"relative p-4 rounded-lg border text-center transition-colors",
													"border-border opacity-50 cursor-not-allowed",
												)}
											>
												<span className="absolute -top-2 left-1/2 -translate-x-1/2 px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground rounded-full">
													Coming soon
												</span>
												<Code2 className="size-5 mx-auto mb-2 text-foreground/70" />
												<div className="text-[13px] font-medium">Codex</div>
												<div className="text-[11px] text-muted-foreground mt-0.5">
													Local Codex agent
												</div>
											</button>
										</div>
									</div>

									<div>
										<label className="text-xs text-foreground/60 mb-1.5 block">Model</label>
										<select
											value={adapterModel}
											onChange={(e) => setAdapterModel(e.target.value)}
											className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
										>
											<option value="default">Default</option>
											{adapterType === "claude" && (
												<>
													<option value="claude-opus-4-6">Claude Opus 4.6</option>
													<option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
												</>
											)}
											{adapterType === "codex" && (
												<>
													<option value="o3">o3</option>
													<option value="o4-mini">o4-mini</option>
												</>
											)}
										</select>
									</div>

									<div className="rounded-lg border border-border p-4 flex items-center justify-between">
										<div>
											<div className="text-[13px] font-medium">Adapter environment check</div>
											<div className="text-xs text-muted-foreground mt-0.5">
												Runs a probe that asks the adapter CLI to respond with hello.
											</div>
										</div>
										<Button
											variant="outline"
											size="sm"
											disabled={adapterTesting}
											onClick={async () => {
												setAdapterTesting(true);
												setAdapterTestResult(null);
												try {
													const res = await fetch(`/api/agent/test?adapter=${adapterType}`);
													setAdapterTestResult(res.ok ? "success" : "error");
												} catch {
													setAdapterTestResult("error");
												} finally {
													setAdapterTesting(false);
												}
											}}
										>
											{adapterTesting
												? "Testing..."
												: adapterTestResult === "success"
													? "Passed"
													: "Test now"}
										</Button>
									</div>
									{adapterTestResult === "error" && (
										<div className="text-xs text-destructive">
											{adapterType === "claude" ? "Claude CLI" : "Codex CLI"} not found or not
											responding. Make sure it's installed.
										</div>
									)}
								</div>
							</div>
						)}

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
										<label
											htmlFor="cfg-stoploss"
											className="text-xs text-foreground/60 mb-1.5 block"
										>
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
							<div className="space-y-6">
								<div className="flex items-center gap-3">
									<Rocket className="size-5 text-foreground/60" />
									<div>
										<h3 className="text-sm font-semibold">Review and launch</h3>
										<p className="text-xs text-foreground/50">Confirm your desk configuration.</p>
									</div>
								</div>

								<div className="max-w-md rounded-lg border border-border overflow-hidden">
									{/* Desk name header */}
									<div className="px-5 py-4 bg-muted/50 border-b border-border">
										<div className="text-[13px] font-semibold">{name}</div>
										{description && (
											<div className="text-xs text-muted-foreground mt-0.5">{description}</div>
										)}
									</div>

									{/* Strategy detail */}
									<div className="px-5 py-4 space-y-3 border-b border-border">
										{selectedStrategy ? (
											<>
												<div className="flex items-center gap-2">
													<Badge variant="secondary">
														{categoryMeta[selectedStrategy.category]?.label ??
															selectedStrategy.category}
													</Badge>
													<Badge variant="outline">{selectedStrategy.difficulty}</Badge>
												</div>
												<div className="text-[13px] font-medium">{selectedStrategy.name}</div>
												<div className="text-xs text-muted-foreground">
													{selectedStrategy.summary ?? selectedStrategy.description}
												</div>
												{selectedStrategy.indicators.length > 0 && (
													<div className="flex flex-wrap gap-1">
														{selectedStrategy.indicators.map((ind) => (
															<Badge key={ind} variant="outline" className="text-[10px]">
																{ind}
															</Badge>
														))}
													</div>
												)}
												<div className="flex items-center gap-3 text-xs text-muted-foreground">
													<span>Timeframe: {selectedStrategy.timeframes.join(", ")}</span>
													{selectedStrategy.source && (
														<a
															href={selectedStrategy.source}
															target="_blank"
															rel="noreferrer"
															className="hover:text-foreground underline underline-offset-2"
														>
															Source ↗
														</a>
													)}
												</div>
											</>
										) : selectedStrategyId === "custom" ? (
											<>
												<div className="text-[13px] font-medium">Custom Strategy</div>
												{customStrategyPrompt && (
													<div className="text-xs text-muted-foreground">
														{customStrategyPrompt}
													</div>
												)}
											</>
										) : (
											<div className="text-xs text-muted-foreground">No strategy selected</div>
										)}
									</div>

									{/* Venues */}
									<div className="px-5 py-3 border-b border-border">
										<div className="flex items-center justify-between">
											<span className="text-xs text-muted-foreground">Venues</span>
											<div className="flex gap-1 flex-wrap justify-end">
												{selectedVenues.map((v) => (
													<Badge key={v} variant="secondary" className="text-[10px]">
														{venueName(v)}
													</Badge>
												))}
												{selectedVenues.length === 0 && (
													<span className="text-xs text-muted-foreground">none</span>
												)}
											</div>
										</div>
									</div>

									{/* Metrics */}
									<div className="px-5 py-4 bg-muted/30 grid grid-cols-3 gap-4">
										<div>
											<div className="text-[10px] text-muted-foreground uppercase tracking-wider">
												Budget
											</div>
											<div className="text-sm font-semibold mt-0.5">
												${Number(budget).toLocaleString("en-US")}
											</div>
										</div>
										<div>
											<div className="text-[10px] text-muted-foreground uppercase tracking-wider">
												Target
											</div>
											<div className="text-sm font-semibold text-green-600 dark:text-green-400 mt-0.5">
												+{targetReturn}%
											</div>
										</div>
										<div>
											<div className="text-[10px] text-muted-foreground uppercase tracking-wider">
												Stop Loss
											</div>
											<div className="text-sm font-semibold text-destructive mt-0.5">
												-{stopLoss}%
											</div>
										</div>
									</div>
								</div>

								{submitError && (
									<div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
										{submitError}
									</div>
								)}
							</div>
						)}
						{/* Footer — inside content */}
						<div className="flex items-center justify-between pt-8">
							{stepIndex > 0 ? (
								<Button
									variant="ghost"
									onClick={() => setStepIndex(stepIndex - 1)}
									className="gap-1.5"
								>
									<ArrowLeft className="size-4" />
									Back
								</Button>
							) : (
								<div />
							)}
							{step === "launch" ? (
								<Button
									onClick={handleSubmit}
									disabled={submitting || !canLaunch}
									className="gap-1.5"
								>
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
				</div>
			</dialog>
			{folderPicker && (
				<FolderPickerModal
					initialPath={
						folderPicker.kind === "seed"
							? seedCodePath || undefined
							: externalMounts[folderPicker.index]?.hostPath || undefined
					}
					onSelect={(picked) => {
						if (folderPicker.kind === "seed") {
							setSeedCodePath(picked);
						} else {
							const idx = folderPicker.index;
							setExternalMounts((prev) =>
								prev.map((row, i) => (i === idx ? { ...row, hostPath: picked } : row)),
							);
						}
						setFolderPicker(null);
					}}
					onClose={() => setFolderPicker(null)}
				/>
			)}
		</>
	);
}
