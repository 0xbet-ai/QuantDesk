import { ChevronRight, Download, Settings, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import type { Desk } from "../lib/api.js";
import { archiveDesk, updateDesk } from "../lib/api.js";

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
		<div className="space-y-1.5">
			<label className="text-xs text-muted-foreground">{label}</label>
			{children}
		</div>
	);
}

export function DeskSettings({ desk, onUpdated, onArchived }: Props) {
	const [name, setName] = useState(desk.name);
	const [description, setDescription] = useState(desk.description ?? "");
	const [budget, setBudget] = useState(desk.budget);
	const [targetReturn, setTargetReturn] = useState(desk.targetReturn);
	const [stopLoss, setStopLoss] = useState(desk.stopLoss);
	const [saving, setSaving] = useState(false);
	const [archiving, setArchiving] = useState(false);

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
						<h2 className="text-sm font-semibold">Desk Settings</h2>
					</div>

					{/* General */}
					<Section label="General">
						<Field label="Desk name">
							<Input value={name} onChange={(e) => setName(e.target.value)} />
						</Field>
						<Field label="Description">
							<Textarea
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								rows={3}
								placeholder="Optional desk description"
							/>
						</Field>
					</Section>

					{/* Constraints */}
					<Section label="Constraints">
						<Field label="Budget (USD)">
							<Input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} />
						</Field>
						<Field label="Target return %">
							<Input
								type="number"
								value={targetReturn}
								onChange={(e) => setTargetReturn(e.target.value)}
							/>
						</Field>
						<Field label="Stop loss % (max drawdown)">
							<Input type="number" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} />
						</Field>
					</Section>

					{/* Save */}
					{hasChanges && (
						<Button onClick={handleSave} disabled={saving || !name.trim()}>
							{saving ? "Saving..." : "Save changes"}
						</Button>
					)}

					{/* Export / Import */}
					<Section label="Desk Package">
						<p className="text-[13px] text-muted-foreground">
							Export this desk as a JSON package (settings, strategy, experiments) or import from a
							file.
						</p>
						<div className="flex gap-2">
							<Button variant="outline" size="sm" disabled>
								<Download className="size-4" />
								Export
							</Button>
							<Button variant="outline" size="sm" disabled>
								<Upload className="size-4" />
								Import
							</Button>
						</div>
					</Section>

					{/* Danger Zone */}
					<div>
						<div className="text-[10px] font-medium uppercase tracking-widest font-mono text-destructive mb-3">
							Danger Zone
						</div>
						<div className="rounded-lg border border-destructive/30 p-4 space-y-3">
							<p className="text-[13px] text-muted-foreground">
								Archive this desk to hide it from the sidebar. This persists in the database.
							</p>
							<Button variant="destructive" size="sm" onClick={handleArchive} disabled={archiving}>
								{archiving ? "Archiving..." : "Archive desk"}
							</Button>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
