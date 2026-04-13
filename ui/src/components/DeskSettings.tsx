import { ChevronRight, Download, Lock, Settings, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import strategyCatalog from "../../../strategies/freqtrade.json";
import nautilusCatalog from "../../../strategies/nautilus.json";
import venues from "../../../strategies/venues.json";
import type { Desk } from "../lib/api.js";
import { archiveDesk, exportDesk, importDeskPackage, updateDesk } from "../lib/api.js";

const allStrategies = [...strategyCatalog, ...nautilusCatalog];

function formatCategory(cat: string): string {
	return cat
		.split("_")
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");
}
import { Badge } from "./ui/badge.js";

import { Button } from "./ui/button.js";
import { Input } from "./ui/input.js";
import { Textarea } from "./ui/textarea.js";

interface Props {
	desk: Desk;
	onUpdated: () => void;
	onArchived: () => void;
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div>
			<div className="text-[10px] font-medium uppercase tracking-widest font-mono text-muted-foreground mb-3">
				{label}
			</div>
			<div className="rounded-lg border border-border p-4 space-y-4">{children}</div>
		</div>
	);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-2">
			<label className="text-xs text-muted-foreground">{label}</label>
			<div>{children}</div>
		</div>
	);
}

export function DeskSettings({ desk, onUpdated, onArchived }: Props) {
	const { t } = useTranslation();
	const [name, setName] = useState(desk.name);
	const [description, setDescription] = useState(desk.description ?? "");
	const [budget, setBudget] = useState(desk.budget);
	const [targetReturn, setTargetReturn] = useState(desk.targetReturn);
	const [stopLoss, setStopLoss] = useState(desk.stopLoss);
	const [saving, setSaving] = useState(false);
	const [archiving, setArchiving] = useState(false);
	const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
	const [archiveConfirmText, setArchiveConfirmText] = useState("");
	const [exporting, setExporting] = useState(false);
	const importRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		setName(desk.name);
		setDescription(desk.description ?? "");
		setBudget(desk.budget);
		setTargetReturn(desk.targetReturn);
		setStopLoss(desk.stopLoss);
	}, [desk]);

	const hasChanges =
		name !== desk.name ||
		description !== (desk.description ?? "") ||
		budget !== desk.budget ||
		targetReturn !== desk.targetReturn ||
		stopLoss !== desk.stopLoss;

	const handleSave = async () => {
		setSaving(true);
		try {
			await updateDesk(desk.id, {
				name,
				description: description || null,
				budget,
				targetReturn,
				stopLoss,
			});
			onUpdated();
		} catch (err) {
			console.error(err);
		} finally {
			setSaving(false);
		}
	};

	const handleArchive = async () => {
		setArchiving(true);
		try {
			await archiveDesk(desk.id);
			onArchived();
		} catch (err) {
			console.error(err);
		} finally {
			setArchiving(false);
		}
	};

	return (
		<div className="flex flex-col h-full">
			{/* Breadcrumb */}
			<div className="px-6 h-12 flex items-center gap-1.5 text-[13px] text-muted-foreground shrink-0 border-b border-border">
				<span>{desk.name}</span>
				<ChevronRight className="size-3" />
				<span className="text-foreground font-medium">Settings</span>
			</div>

			{/* Content */}
			<div className="flex-1 overflow-y-auto">
				<div className="max-w-xl px-6 py-8 space-y-8">
					{/* Title */}
					<div className="flex items-center gap-2.5">
						<Settings className="size-5 text-muted-foreground" />
						<h2 className="text-sm font-semibold">{t("settings.title")}</h2>
					</div>

					{/* General */}
					<Section label={t("settings.general")}>
						<Field label={t("settings.deskName")}>
							<Input value={name} onChange={(e) => setName(e.target.value)} />
						</Field>
						<Field label={t("settings.description")}>
							<Textarea
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								rows={3}
								placeholder={t("settings.descriptionPlaceholder")}
							/>
						</Field>
					</Section>

					{/* Constraints */}
					<Section label={t("settings.constraints")}>
						<Field label={t("settings.budgetUsd")}>
							<Input
								inputMode="numeric"
								value={Number(budget).toLocaleString("en-US")}
								onChange={(e) => {
									const raw = e.target.value.replace(/,/g, "");
									if (/^\d*$/.test(raw)) setBudget(raw);
								}}
							/>
						</Field>
						<Field label={t("settings.targetReturn")}>
							<Input
								type="number"
								value={targetReturn}
								onChange={(e) => setTargetReturn(e.target.value)}
							/>
						</Field>
						<Field label={t("settings.stopLoss")}>
							<Input type="number" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} />
						</Field>
					</Section>

					{/* Strategy & Venues (immutable) */}
					<div>
						<div className="flex items-center gap-1.5 mb-3">
							<div className="text-[10px] font-medium uppercase tracking-widest font-mono text-muted-foreground">
								{t("settings.strategyAndVenues")}
							</div>
							<Lock className="size-3 text-muted-foreground" />
						</div>
						<div className="rounded-lg border border-border p-4 space-y-5">
							{(() => {
								const strategy = desk.strategyId
									? allStrategies.find((s) => s.id === desk.strategyId)
									: null;
								if (strategy) {
									return (
										<div className="space-y-3">
											<div className="flex items-center gap-2">
												<Badge variant="secondary">{formatCategory(strategy.category)}</Badge>
												<Badge variant="outline">{strategy.difficulty}</Badge>
											</div>
											<div className="text-[13px] font-medium">{strategy.name}</div>
											<div className="text-xs text-muted-foreground">{strategy.description}</div>
											{strategy.indicators.length > 0 && (
												<div className="flex flex-wrap gap-1">
													{strategy.indicators.map((ind) => (
														<Badge key={ind} variant="outline" className="text-[10px]">
															{ind}
														</Badge>
													))}
												</div>
											)}
											<div className="flex items-center gap-3 text-xs text-muted-foreground">
												<span>Timeframe: {strategy.timeframes.join(", ")}</span>
												{strategy.source && (
													<a
														href={strategy.source}
														target="_blank"
														rel="noreferrer"
														className="hover:text-foreground underline underline-offset-2"
													>
														Source ↗
													</a>
												)}
											</div>
										</div>
									);
								}
								return (
									<div className="space-y-1">
										<div className="text-[13px] font-medium">{t("settings.customStrategy")}</div>
										{desk.description && (
											<div className="text-xs text-muted-foreground">{desk.description}</div>
										)}
									</div>
								);
							})()}
							<Field label={t("settings.venues")}>
								{desk.venues.length > 0 ? (
									<div className="flex flex-wrap gap-1.5">
										{(desk.venues as string[]).map((v) => {
											const venue = venues.find((ven) => ven.id === v);
											return (
												<Badge key={v} variant="secondary">
													{venue?.name ?? v}
												</Badge>
											);
										})}
									</div>
								) : (
									<div className="text-[13px] text-muted-foreground">{t("settings.noVenues")}</div>
								)}
							</Field>
							<Field label={t("settings.engine")}>
								<div className="flex items-center gap-2">
									<Badge variant="outline" className="font-mono">
										{desk.engine}
									</Badge>
									<span
										className="text-xs text-muted-foreground"
										title="Auto-derived from (strategy mode, venue) at desk creation; immutable for the desk's lifetime"
									>
										{t("settings.autoDerived", {
											mode: desk.strategyMode,
											venue: desk.venues[0] ?? "venue",
										})}
									</span>
								</div>
							</Field>
							<Field label="Agent">
								<div className="flex items-center gap-2">
									<Badge variant="outline" className="font-mono">
										{desk.adapterType ?? "claude"}
									</Badge>
									{(() => {
										const model = desk.adapterConfig?.model;
										if (typeof model === "string" && model !== "default") {
											return <span className="text-xs text-muted-foreground">{model}</span>;
										}
										return null;
									})()}
								</div>
							</Field>
							<p className="text-xs text-muted-foreground">{t("settings.setAtCreation")}</p>
						</div>
					</div>

					{/* Save */}
					{hasChanges && (
						<Button onClick={handleSave} disabled={saving || !name.trim()}>
							{saving ? t("settings.saving") : t("settings.saveChanges")}
						</Button>
					)}

					{/* Export / Import */}
					<Section label={t("settings.deskPackage")}>
						<p className="text-[13px] text-muted-foreground">{t("settings.exportDesc")}</p>
						<div className="flex gap-2">
							<Button
								variant="outline"
								size="sm"
								disabled={exporting}
								onClick={async () => {
									setExporting(true);
									try {
										const pkg = await exportDesk(desk.id);
										const blob = new Blob([JSON.stringify(pkg, null, 2)], {
											type: "application/json",
										});
										const url = URL.createObjectURL(blob);
										const a = document.createElement("a");
										a.href = url;
										a.download = `${desk.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_${new Date().toISOString().slice(0, 10)}.json`;
										a.click();
										URL.revokeObjectURL(url);
									} catch (err) {
										console.error("Export failed:", err);
									} finally {
										setExporting(false);
									}
								}}
							>
								<Download className="size-4" />
								{exporting ? t("settings.exporting") : t("settings.export")}
							</Button>
							<Button variant="outline" size="sm" onClick={() => importRef.current?.click()}>
								<Upload className="size-4" />
								{t("settings.import")}
							</Button>
							<input
								ref={importRef}
								type="file"
								accept=".json"
								className="hidden"
								onChange={async (e) => {
									const file = e.target.files?.[0];
									if (!file) return;
									try {
										const text = await file.text();
										const pkg = JSON.parse(text);
										const result = await importDeskPackage(pkg);
										alert(
											`Imported desk with ${result.experimentCount} experiment(s). Refresh to see it in the sidebar.`,
										);
										onUpdated();
									} catch (err) {
										console.error("Import failed:", err);
										alert("Import failed. Check console for details.");
									} finally {
										e.target.value = "";
									}
								}}
							/>
						</div>
					</Section>

					{/* Danger Zone */}
					<div>
						<div className="text-[10px] font-medium uppercase tracking-widest font-mono text-destructive mb-3">
							{t("settings.dangerZone")}
						</div>
						<div className="rounded-lg border border-destructive/30 p-4 space-y-3">
							<p className="text-[13px] text-muted-foreground">{t("settings.archiveDesc")}</p>
							{!showArchiveConfirm ? (
								<Button variant="destructive" size="sm" onClick={() => setShowArchiveConfirm(true)}>
									{t("settings.archiveDesk")}
								</Button>
							) : (
								<div className="space-y-3">
									<p className="text-[13px] text-foreground">
										Type <span className="font-semibold">{desk.name}</span> to confirm.
									</p>
									<Input
										value={archiveConfirmText}
										onChange={(e) => setArchiveConfirmText(e.target.value)}
										placeholder={desk.name}
										autoFocus
									/>
									<div className="flex gap-2">
										<Button
											variant="destructive"
											size="sm"
											onClick={handleArchive}
											disabled={archiving || archiveConfirmText !== desk.name}
										>
											{archiving ? "Archiving..." : "Confirm archive"}
										</Button>
										<Button
											variant="ghost"
											size="sm"
											onClick={() => {
												setShowArchiveConfirm(false);
												setArchiveConfirmText("");
											}}
										>
											Cancel
										</Button>
									</div>
								</div>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
