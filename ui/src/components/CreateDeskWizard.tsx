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
	ChevronDown,
	Code2,
	Crosshair,
	FlaskConical,
	GitBranch,
	Globe,
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
import { useTranslation } from "react-i18next";
import venues from "../../../strategies/venues.json";
import type { Dataset, Strategy, StrategyMode } from "../lib/api.js";
import { createDesk, listAllDatasets, listStrategies } from "../lib/api.js";
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

const stepTabs: {
	key: Step;
	i18nKey: string;
	icon: React.ComponentType<{ className?: string }>;
}[] = [
	{ key: "desk", i18nKey: "wizard.desk", icon: DeskIcon },
	{ key: "market", i18nKey: "wizard.market", icon: Layers },
	{ key: "venue", i18nKey: "wizard.venue", icon: Store },
	{ key: "mode", i18nKey: "wizard.mode", icon: Zap },
	{ key: "strategy", i18nKey: "wizard.strategy", icon: FlaskConical },
	{ key: "agent", i18nKey: "wizard.agent", icon: Bot },
	{ key: "config", i18nKey: "wizard.config", icon: Settings2 },
	{ key: "launch", i18nKey: "wizard.launch", icon: Rocket },
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
	i18nLabel: string;
	i18nDescription: string;
	icon: typeof Bitcoin;
	enabled: boolean;
}[] = [
	{
		id: "crypto",
		i18nLabel: "wizard.crypto",
		i18nDescription: "wizard.cryptoDescription",
		icon: Bitcoin,
		enabled: true,
	},
	{
		id: "stocks",
		i18nLabel: "wizard.stocks",
		i18nDescription: "wizard.stocksDescription",
		icon: TrendingUp,
		enabled: false,
	},
	{
		id: "prediction",
		i18nLabel: "wizard.predictionMarkets",
		i18nDescription: "wizard.predictionMarketsDescription",
		icon: Trophy,
		enabled: true,
	},
	{
		id: "fx",
		i18nLabel: "wizard.fx",
		i18nDescription: "wizard.fxDescription",
		icon: ArrowLeftRight,
		enabled: false,
	},
	{
		id: "commodities",
		i18nLabel: "wizard.commodities",
		i18nDescription: "wizard.commoditiesDescription",
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

const assetClassI18nKeys: Record<string, string> = {
	crypto: "wizard.crypto",
	stocks: "wizard.stocks",
	fx: "wizard.fx",
	commodities: "wizard.commodities",
	prediction: "wizard.predictionMarkets",
};

const venueTypeI18nKeys: Record<string, string> = {
	cex: "wizard.centralized",
	dex: "wizard.decentralized",
	broker: "wizard.brokers",
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
	const { t } = useTranslation();
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
	// Global catalog of datasets already registered in other desks. The
	// user can tick any of these to link them into the new desk at creation
	// time (DB `desk_datasets` join + workspace symlink, no re-download).
	const [availableDatasets, setAvailableDatasets] = useState<Dataset[]>([]);
	const [reusedDatasetIds, setReusedDatasetIds] = useState<string[]>([]);
	const [datasetsLoading, setDatasetsLoading] = useState(false);
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
	const [adapterType, setAdapterType] = useState<"claude" | "codex" | "gemini" | "http">("claude");
	const [showMoreAdapters, setShowMoreAdapters] = useState(false);
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

	// Load the global dataset catalog once the user lands on the strategy
	// step — that's the only step where the "Bring your own" section is
	// rendered, so we can avoid the request on non-custom flows that never
	// open the picker. Failures are non-fatal: the picker just shows empty.
	// Uses a ref (not state) to flag "already fetched" because an empty
	// response must still count as a completed fetch — otherwise
	// `availableDatasets.length === 0` would re-trigger the effect forever.
	const datasetsFetchedRef = useRef(false);
	useEffect(() => {
		if (step !== "strategy" || datasetsFetchedRef.current) return;
		datasetsFetchedRef.current = true;
		setDatasetsLoading(true);
		listAllDatasets()
			.then(setAvailableDatasets)
			.catch(() => setAvailableDatasets([]))
			.finally(() => setDatasetsLoading(false));
	}, [step]);

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
				reusedDatasetIds: isCustom && reusedDatasetIds.length > 0 ? reusedDatasetIds : undefined,
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
		reusedDatasetIds,
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
										{t(tab.i18nKey)}
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
										<h3 className="text-sm font-semibold">{t("wizard.nameYourDesk")}</h3>
										<p className="text-xs text-foreground/50">{t("wizard.nameYourDeskDesc")}</p>
									</div>
								</div>
								<div className="space-y-4 max-w-sm">
									<div>
										<label htmlFor="desk-name" className="text-xs text-foreground/60 mb-1.5 block">
											{t("wizard.deskName")}
										</label>
										<Input
											id="desk-name"
											value={name}
											onChange={(e) => setName(e.target.value)}
											placeholder={t("wizard.deskNamePlaceholder")}
											autoFocus
										/>
									</div>
									<div>
										<label htmlFor="desk-desc" className="text-xs text-foreground/60 mb-1.5 block">
											{t("wizard.missionGoal")} <span className="text-red-500">*</span>
										</label>
										<Textarea
											id="desk-desc"
											value={description}
											onChange={(e) => setDescription(e.target.value)}
											rows={4}
											placeholder={t("wizard.missionPlaceholder")}
										/>
										<p className="text-[11px] text-foreground/40 mt-1">{t("wizard.missionHint")}</p>
									</div>
								</div>
							</div>
						)}

						{step === "market" && (
							<div className="space-y-6">
								<div className="flex items-center gap-3 mb-2">
									<Layers className="size-5 text-foreground/60" />
									<div>
										<h3 className="text-sm font-semibold">{t("wizard.pickMarket")}</h3>
										<p className="text-xs text-foreground/50">{t("wizard.pickMarketDesc")}</p>
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
														{t(m.i18nLabel)}
														{!m.enabled && (
															<span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
																{t("wizard.soon")}
															</span>
														)}
													</div>
													<div className="text-xs text-foreground/60 leading-snug">
														{t(m.i18nDescription)}
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
											{t("wizard.selectVenues")} —{" "}
											{t(assetClassI18nKeys[selectedAssetClass] ?? selectedAssetClass)}
										</h3>
										<p className="text-xs text-foreground/50">{t("wizard.selectVenuesDesc")}</p>
									</div>
								</div>

								{(() => {
									const byType = venuesByAssetClass[selectedAssetClass];
									if (!byType) {
										return (
											<div className="text-xs text-foreground/50">
												{t("wizard.noVenuesAvailable")}
											</div>
										);
									}
									return TYPE_ORDER.map((type) => {
										const list = byType[type];
										if (!list || list.length === 0) return null;
										return (
											<div key={`${selectedAssetClass}-${type}`}>
												<div className="text-[10px] font-medium uppercase tracking-widest font-mono text-foreground/50 mb-2">
													{t(venueTypeI18nKeys[type] ?? type)}
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
										{t("wizard.custom")}
									</div>
									<div className="flex gap-2">
										<Input
											id="custom-venue"
											aria-label="Custom venue name"
											value={customVenue}
											onChange={(e) => setCustomVenue(e.target.value)}
											onKeyDown={(e) => e.key === "Enter" && addCustomVenue()}
											placeholder={t("wizard.customVenuePlaceholder")}
											className="flex-1"
										/>
										<Button variant="outline" size="sm" onClick={addCustomVenue}>
											{t("wizard.add")}
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
									<h3 className="text-sm font-medium">{t("wizard.modeTitle")}</h3>
									<p className="text-xs text-muted-foreground">{t("wizard.modeDesc")}</p>
								</div>
								<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
									{(["classic", "realtime"] as const).map((mode) => {
										const enabled = availableModes.includes(mode);
										const active = selectedMode === mode;
										const title = mode === "classic" ? t("wizard.classic") : t("wizard.realtime");
										const tag = mode === "classic" ? t("wizard.recommended") : t("wizard.advanced");
										const desc =
											mode === "classic"
												? t("wizard.classicModeDesc")
												: t("wizard.realtimeModeDesc");
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
														{t("wizard.modeNotAvailable")}
													</p>
												)}
											</button>
										);
									})}
								</div>
								{availableModes.length === 0 && selectedVenues.length > 0 && (
									<p className="text-xs text-destructive">{t("wizard.noModeWarning")}</p>
								)}
							</div>
						)}

						{step === "strategy" &&
							(() => {
								if (loadingStrategies) {
									return (
										<div className="py-12 text-center text-sm text-muted-foreground">
											{t("wizard.loadingStrategies")}
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
												{t("wizard.retry")}
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
													<h3 className="text-sm font-semibold">{t("wizard.chooseStrategy")}</h3>
													<p className="text-xs text-foreground/50">
														{t("wizard.chooseStrategyDesc")}
													</p>
												</div>
											</div>

											{/* Search */}
											<div className="relative max-w-sm">
												<Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
												<Input
													value={strategySearch}
													onChange={(e) => setStrategySearch(e.target.value)}
													placeholder={t("wizard.searchPlaceholder")}
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
																{t("wizard.customStrategy")}
															</div>
															<div className="text-[11px] text-foreground/50">
																{t("wizard.customStrategyDesc")}
															</div>
														</div>
													</div>
												</button>
											)}

											{filteredStrategies.length === 0 && strategySearch && (
												<p className="text-[13px] text-muted-foreground py-6 text-center">
													{t("wizard.noStrategiesMatch", { search: strategySearch })}
												</p>
											)}

											{/* Strategies grouped by category */}
											{categories.map((cat) => {
												const meta = categoryMeta[cat] ?? { label: cat, icon: FlaskConical };
												const CatIcon = meta.icon;
												const difficultyRank: Record<string, number> = {
													easy: 0,
													medium: 1,
													advanced: 2,
												};
												const catStrategies = filteredStrategies
													.filter((s) => s.category === cat)
													.slice()
													.sort((a, b) => {
														const ra = difficultyRank[a.difficulty] ?? 99;
														const rb = difficultyRank[b.difficulty] ?? 99;
														if (ra !== rb) return ra - rb;
														return a.name.localeCompare(b.name);
													});
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
																{t("wizard.indicators")}
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
															{t("wizard.timeframes")}{" "}
															<span className="text-foreground/30 normal-case tracking-normal">
																{t("wizard.recommend")}
															</span>
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
															{t("wizard.viewSource")} ↗
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
															<div className="text-sm font-semibold">
																{t("wizard.customStrategy")}
															</div>
															<div className="text-xs text-foreground/50 mt-0.5">
																{t("wizard.customStrategyDetailDesc")}
															</div>
														</div>
													</div>
													<div>
														<label
															htmlFor="strategy-prompt"
															className="text-[10px] font-medium uppercase tracking-widest text-foreground/40 mb-1.5 block"
														>
															{t("wizard.yourDescription")}
														</label>
														<Textarea
															id="strategy-prompt"
															value={customStrategyPrompt}
															onChange={(e) => setCustomStrategyPrompt(e.target.value)}
															rows={10}
															className="min-h-[200px] resize-y"
															placeholder={t("wizard.customStrategyPlaceholder")}
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
															{t("wizard.bringYourOwn")}
														</div>
														<div className="space-y-3">
															<div>
																<label
																	htmlFor="seed-code-path"
																	className="text-xs font-medium text-foreground/70 mb-1 block"
																>
																	{t("wizard.seedCodeDir")}
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
																		{t("wizard.browse")}
																	</button>
																</div>
																<div className="text-[10px] text-foreground/40 mt-1">
																	{t("wizard.seedCodeHint")}
																</div>
															</div>

															<div>
																<div className="flex items-center justify-between mb-1">
																	<span className="text-xs font-medium text-foreground/70">
																		{t("wizard.externalDatasets")}
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
																		+ {t("wizard.add")}
																	</button>
																</div>
																{externalMounts.length === 0 ? (
																	<div className="text-[10px] text-foreground/40">
																		{t("wizard.externalDatasetsHint")}
																	</div>
																) : (
																	<div className="space-y-2.5">
																		{externalMounts.map((m, i) => (
																			<div
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
																						{t("wizard.browse")}
																					</button>
																				</div>
																			</div>
																		))}
																	</div>
																)}
															</div>

															<div>
																<div className="flex items-center justify-between mb-1">
																	<span className="text-xs font-medium text-foreground/70">
																		{t("wizard.reuseDatasets")}
																	</span>
																	{availableDatasets.length > 0 && (
																		<span className="text-[10px] text-foreground/40 tabular-nums">
																			{reusedDatasetIds.length} / {availableDatasets.length}{" "}
																			{t("wizard.selected")}
																		</span>
																	)}
																</div>
																{datasetsLoading ? (
																	<div className="text-[10px] text-foreground/40">
																		{t("common.loading")}
																	</div>
																) : availableDatasets.length === 0 ? (
																	<div className="text-[10px] text-foreground/40">
																		{t("wizard.noDatasetsYet")}
																	</div>
																) : (
																	<div className="rounded-md border border-border bg-muted/20 max-h-44 overflow-y-auto divide-y divide-border/60">
																		{availableDatasets.map((d) => {
																			const checked = reusedDatasetIds.includes(d.id);
																			// CCXT perp symbols look like "BTC/USDC:USDC" — strip the
																			// `:settle` suffix for the label (the perp badge itself
																			// comes from the explicit tradingMode column, not from
																			// pair-string parsing, so mis-suffixed rows still render
																			// correctly).
																			const pairsText = d.pairs
																				.map((p) => p.split(":")[0])
																				.join(", ");
																			const isPerp = d.tradingMode === "futures";
																			const deskLabel = d.createdByDeskName ?? null;
																			return (
																				<label
																					key={d.id}
																					className={cn(
																						"flex items-start gap-2 px-2 py-1.5 text-[11px] cursor-pointer transition-colors",
																						checked ? "bg-accent/30" : "hover:bg-accent/20",
																					)}
																				>
																					<input
																						type="checkbox"
																						checked={checked}
																						onChange={() =>
																							setReusedDatasetIds((prev) =>
																								prev.includes(d.id)
																									? prev.filter((id) => id !== d.id)
																									: [...prev, d.id],
																							)
																						}
																						className="mt-0.5 size-3 shrink-0 accent-foreground"
																					/>
																					<div className="flex-1 min-w-0">
																						<div className="flex items-baseline gap-1.5 flex-wrap">
																							<span className="font-mono font-medium text-foreground">
																								{pairsText}
																							</span>
																							{isPerp && (
																								<span className="text-[9px] px-1 py-px rounded bg-muted text-muted-foreground uppercase leading-none">
																									perp
																								</span>
																							)}
																							<span className="text-foreground/60 font-mono">
																								{d.timeframe}
																							</span>
																							<span className="text-foreground/50">
																								{d.exchange}
																							</span>
																						</div>
																						<div className="flex items-baseline gap-1.5 flex-wrap text-foreground/40 text-[10px] font-mono mt-0.5">
																							<span>
																								{new Date(
																									d.dateRange.start + "T00:00:00",
																								).toLocaleDateString("en-US")}{" "}
																								→{" "}
																								{new Date(
																									d.dateRange.end + "T00:00:00",
																								).toLocaleDateString("en-US")}
																							</span>
																							{deskLabel && (
																								<>
																									<span className="text-foreground/25">·</span>
																									<span
																										className="truncate"
																										title={t("wizard.fromDesk", {
																											desk: deskLabel,
																										})}
																									>
																										{t("wizard.fromDesk", { desk: deskLabel })}
																									</span>
																								</>
																							)}
																						</div>
																					</div>
																				</label>
																			);
																		})}
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
										<h3 className="text-sm font-semibold">{t("wizard.configureAgent")}</h3>
										<p className="text-xs text-foreground/50">{t("wizard.configureAgentDesc")}</p>
									</div>
								</div>

								<div className="space-y-4 max-w-lg">
									<div>
										<label className="text-xs text-foreground/60 mb-2 block">
											{t("wizard.adapterType")}
										</label>
										{/* Primary adapters — Recommended */}
										<div className="grid grid-cols-2 gap-3">
											<button
												type="button"
												onClick={() => {
													setAdapterType("claude");
													setAdapterModel("default");
													setAdapterTestResult(null);
												}}
												className={cn(
													"relative p-4 rounded-lg border text-center transition-colors",
													adapterType === "claude"
														? "border-foreground bg-accent"
														: "border-border hover:bg-accent/50",
												)}
											>
												<span className="absolute -top-2 left-1/2 -translate-x-1/2 px-1.5 py-0.5 text-[10px] font-medium bg-green-500 text-white rounded-full">
													{t("wizard.recommended")}
												</span>
												<Sparkles className="size-5 mx-auto mb-2 text-foreground/70" />
												<div className="text-[13px] font-medium">{t("wizard.claudeCode")}</div>
												<div className="text-[11px] text-muted-foreground mt-0.5">
													{t("wizard.claudeCodeDesc")}
												</div>
											</button>
											<button
												type="button"
												onClick={() => {
													setAdapterType("codex");
													setAdapterModel("default");
													setAdapterTestResult(null);
												}}
												className={cn(
													"relative p-4 rounded-lg border text-center transition-colors",
													adapterType === "codex"
														? "border-foreground bg-accent"
														: "border-border hover:bg-accent/50",
												)}
											>
												<span className="absolute -top-2 left-1/2 -translate-x-1/2 px-1.5 py-0.5 text-[10px] font-medium bg-green-500 text-white rounded-full">
													{t("wizard.recommended")}
												</span>
												<Code2 className="size-5 mx-auto mb-2 text-foreground/70" />
												<div className="text-[13px] font-medium">{t("wizard.codex")}</div>
												<div className="text-[11px] text-muted-foreground mt-0.5">
													{t("wizard.codexDesc")}
												</div>
											</button>
										</div>

										{/* More Agent Adapter Types — collapsible */}
										<button
											type="button"
											onClick={() => setShowMoreAdapters((v) => !v)}
											className="flex items-center gap-1.5 text-xs text-foreground/60 hover:text-foreground mt-3 mb-1"
										>
											<ChevronDown
												className={cn(
													"size-3.5 transition-transform",
													showMoreAdapters ? "rotate-0" : "-rotate-90",
												)}
											/>
											{t("wizard.moreAdapterTypes")}
										</button>
										{showMoreAdapters && (
											<div className="grid grid-cols-2 gap-3">
												<button
													type="button"
													onClick={() => {
														setAdapterType("gemini");
														setAdapterModel("default");
														setAdapterTestResult(null);
													}}
													className={cn(
														"relative p-4 rounded-lg border text-center transition-colors",
														adapterType === "gemini"
															? "border-foreground bg-accent"
															: "border-border hover:bg-accent/50",
													)}
												>
													{adapterType === "gemini" && (
														<span className="absolute -top-2 left-1/2 -translate-x-1/2 px-1.5 py-0.5 text-[10px] font-medium bg-green-500 text-white rounded-full">
															{t("wizard.selectedBadge")}
														</span>
													)}
													<Sparkles className="size-5 mx-auto mb-2 text-foreground/70" />
													<div className="text-[13px] font-medium">{t("wizard.geminiCli")}</div>
													<div className="text-[11px] text-muted-foreground mt-0.5">
														{t("wizard.geminiCliDesc")}
													</div>
												</button>
												<button
													type="button"
													onClick={() => {
														setAdapterType("http");
														setAdapterModel("default");
														setAdapterTestResult(null);
													}}
													className={cn(
														"relative p-4 rounded-lg border text-center transition-colors",
														adapterType === "http"
															? "border-foreground bg-accent"
															: "border-border hover:bg-accent/50",
													)}
												>
													{adapterType === "http" && (
														<span className="absolute -top-2 left-1/2 -translate-x-1/2 px-1.5 py-0.5 text-[10px] font-medium bg-green-500 text-white rounded-full">
															{t("wizard.selectedBadge")}
														</span>
													)}
													<Globe className="size-5 mx-auto mb-2 text-foreground/70" />
													<div className="text-[13px] font-medium">{t("wizard.http")}</div>
													<div className="text-[11px] text-muted-foreground mt-0.5">
														{t("wizard.httpDesc")}
													</div>
												</button>
											</div>
										)}
									</div>

									<div>
										<label className="text-xs text-foreground/60 mb-1.5 block">
											{t("wizard.model")}
										</label>
										<select
											value={adapterModel}
											onChange={(e) => setAdapterModel(e.target.value)}
											className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
										>
											<option value="default">{t("wizard.default")}</option>
											{adapterType === "claude" && (
												<>
													<option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
													<option value="claude-haiku-4-6">Claude Haiku 4.6</option>
													<option value="claude-opus-4-6">Claude Opus 4.6</option>
													<option value="claude-sonnet-4-5-20250929">Claude Sonnet 4.5</option>
													<option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
												</>
											)}
											{adapterType === "codex" && (
												<>
													<option value="codex-mini-latest">Codex Mini</option>
													<option value="gpt-5">gpt-5</option>
													<option value="gpt-5-mini">gpt-5-mini</option>
													<option value="gpt-5-nano">gpt-5-nano</option>
													<option value="gpt-5.3-codex">gpt-5.3-codex</option>
													<option value="gpt-5.3-codex-spark">gpt-5.3-codex-spark</option>
													<option value="gpt-5.4">gpt-5.4</option>
													<option value="o3">o3</option>
													<option value="o3-mini">o3-mini</option>
													<option value="o4-mini">o4-mini</option>
												</>
											)}
											{adapterType === "gemini" && (
												<>
													<option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
													<option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
													<option value="gemini-2.5-flash-lite">Gemini 2.5 Flash Lite</option>
													<option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
													<option value="gemini-2.0-flash-lite">Gemini 2.0 Flash Lite</option>
												</>
											)}
										</select>
									</div>

									<div className="rounded-lg border border-border p-4 flex items-center justify-between">
										<div>
											<div className="text-[13px] font-medium">{t("wizard.adapterCheck")}</div>
											<div className="text-xs text-muted-foreground mt-0.5">
												{t("wizard.adapterCheckDesc")}
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
												? t("wizard.testing")
												: adapterTestResult === "success"
													? t("wizard.passed")
													: t("wizard.testNow")}
										</Button>
									</div>
									{adapterTestResult === "error" && (
										<div className="text-xs text-destructive">
											{t("wizard.cliNotFound", {
												adapter:
													adapterType === "claude"
														? "Claude"
														: adapterType === "codex"
															? "Codex"
															: adapterType === "gemini"
																? "Gemini"
																: "HTTP",
											})}
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
										<h3 className="text-sm font-semibold">{t("wizard.configureConstraints")}</h3>
										<p className="text-xs text-foreground/50">
											{t("wizard.configureConstraintsDesc")}
										</p>
									</div>
								</div>

								<div className="space-y-4 max-w-xs">
									<div>
										<label htmlFor="cfg-budget" className="text-xs text-foreground/60 mb-1.5 block">
											{t("wizard.budgetUsd")}
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
											{t("wizard.targetReturn")}
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
											{t("wizard.stopLoss")}
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
										<h3 className="text-sm font-semibold">{t("wizard.reviewAndLaunch")}</h3>
										<p className="text-xs text-foreground/50">{t("wizard.reviewAndLaunchDesc")}</p>
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
													<span>
														{t("wizard.timeframeLabel")}: {selectedStrategy.timeframes.join(", ")}
													</span>
													{selectedStrategy.source && (
														<a
															href={selectedStrategy.source}
															target="_blank"
															rel="noreferrer"
															className="hover:text-foreground underline underline-offset-2"
														>
															{t("wizard.source")} ↗
														</a>
													)}
												</div>
											</>
										) : selectedStrategyId === "custom" ? (
											<>
												<div className="text-[13px] font-medium">{t("wizard.customStrategy")}</div>
												{customStrategyPrompt && (
													<div className="text-xs text-muted-foreground">
														{customStrategyPrompt}
													</div>
												)}
											</>
										) : (
											<div className="text-xs text-muted-foreground">
												{t("wizard.noStrategySelected")}
											</div>
										)}
									</div>

									{/* Venues */}
									<div className="px-5 py-3 border-b border-border">
										<div className="flex items-center justify-between">
											<span className="text-xs text-muted-foreground">
												{t("wizard.venuesLabel")}
											</span>
											<div className="flex gap-1 flex-wrap justify-end">
												{selectedVenues.map((v) => (
													<Badge key={v} variant="secondary" className="text-[10px]">
														{venueName(v)}
													</Badge>
												))}
												{selectedVenues.length === 0 && (
													<span className="text-xs text-muted-foreground">{t("wizard.none")}</span>
												)}
											</div>
										</div>
									</div>

									{/* Metrics */}
									<div className="px-5 py-4 bg-muted/30 grid grid-cols-3 gap-4">
										<div>
											<div className="text-[10px] text-muted-foreground uppercase tracking-wider">
												{t("wizard.budgetLabel")}
											</div>
											<div className="text-sm font-semibold mt-0.5">
												${Number(budget).toLocaleString("en-US")}
											</div>
										</div>
										<div>
											<div className="text-[10px] text-muted-foreground uppercase tracking-wider">
												{t("wizard.targetLabel")}
											</div>
											<div className="text-sm font-semibold text-green-600 dark:text-green-400 mt-0.5">
												+{targetReturn}%
											</div>
										</div>
										<div>
											<div className="text-[10px] text-muted-foreground uppercase tracking-wider">
												{t("wizard.stopLossLabel")}
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
									{t("common.back")}
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
									{submitting ? t("wizard.creating") : t("wizard.launch")}
								</Button>
							) : (
								<Button
									onClick={() => setStepIndex(stepIndex + 1)}
									disabled={!canProceed}
									className="gap-1.5"
								>
									<ArrowRight className="size-4" />
									{t("common.next")}
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
