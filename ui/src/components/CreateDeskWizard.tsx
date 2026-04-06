import { useEffect, useState } from "react";
import venues from "../../../strategies/venues.json";
import { createDesk, listStrategies } from "../lib/api.js";
import type { Strategy } from "../lib/api.js";

interface Props {
	onClose: () => void;
	onCreated: (deskId: string) => void;
}

type Step = "desk" | "venue" | "strategy" | "config" | "launch";
const steps: Step[] = ["desk", "venue", "strategy", "config", "launch"];

export function CreateDeskWizard({ onClose, onCreated }: Props) {
	const [step, setStep] = useState<Step>("desk");
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [selectedVenues, setSelectedVenues] = useState<string[]>([]);
	const [customVenue, setCustomVenue] = useState("");
	const [strategies, setStrategies] = useState<Strategy[]>([]);
	const [selectedStrategyId, setSelectedStrategyId] = useState<string | null>(null);
	const [budget, setBudget] = useState("10000");
	const [targetReturn, setTargetReturn] = useState("15");
	const [stopLoss, setStopLoss] = useState("5");
	const [submitting, setSubmitting] = useState(false);

	const stepIndex = steps.indexOf(step);

	useEffect(() => {
		if (step === "strategy") {
			listStrategies()
				.then(setStrategies)
				.catch(() => {});
		}
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

	const filteredStrategies = strategies.filter((s) => {
		if (selectedVenues.length === 0) return true;
		const venueEngines = selectedVenues.flatMap(
			(v) => venues.find((ve) => ve.id === v)?.engines ?? ["generic"],
		);
		return venueEngines.includes(s.engine);
	});

	const selectedStrategy = strategies.find((s) => s.id === selectedStrategyId);

	const handleSubmit = async () => {
		setSubmitting(true);
		try {
			const result = await createDesk({
				name,
				budget,
				targetReturn,
				stopLoss,
				venues: selectedVenues,
				engine: selectedStrategy?.engine ?? "generic",
				strategyId: selectedStrategyId ?? undefined,
				description: description || undefined,
			});
			onCreated(result.desk.id);
		} catch (err) {
			console.error(err);
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
			<div className="bg-gray-900 border border-gray-700 rounded-lg w-[520px] max-h-[80vh] flex flex-col">
				<div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
					<h2 className="text-sm font-semibold">
						New Desk — Step {stepIndex + 1}/{steps.length}
					</h2>
					<button type="button" onClick={onClose} className="text-gray-500 hover:text-white">
						x
					</button>
				</div>

				<div className="flex-1 overflow-y-auto px-5 py-4">
					{step === "desk" && (
						<div className="space-y-3">
							<label className="block text-xs text-gray-400">
								Desk Name
								<input
									type="text"
									value={name}
									onChange={(e) => setName(e.target.value)}
									className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm"
								/>
							</label>
							<label className="block text-xs text-gray-400">
								Description
								<textarea
									value={description}
									onChange={(e) => setDescription(e.target.value)}
									rows={3}
									className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm"
								/>
							</label>
						</div>
					)}

					{step === "venue" && (
						<div>
							<div className="text-xs text-gray-400 mb-2">Where do you trade?</div>
							<div className="flex flex-wrap gap-2">
								{venues.map((v) => (
									<button
										key={v.id}
										type="button"
										onClick={() => toggleVenue(v.id)}
										className={`px-3 py-1.5 rounded-full text-xs border ${
											selectedVenues.includes(v.id)
												? "bg-blue-600 border-blue-500 text-white"
												: "bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500"
										}`}
									>
										{v.name}
									</button>
								))}
							</div>
							<div className="flex gap-2 mt-3">
								<input
									type="text"
									value={customVenue}
									onChange={(e) => setCustomVenue(e.target.value)}
									onKeyDown={(e) => e.key === "Enter" && addCustomVenue()}
									placeholder="+ Add custom venue"
									className="flex-1 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs"
								/>
								<button
									type="button"
									onClick={addCustomVenue}
									className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs"
								>
									Add
								</button>
							</div>
						</div>
					)}

					{step === "strategy" && (
						<div>
							<div className="text-xs text-gray-400 mb-2">Pick a strategy or describe your own</div>
							<div className="space-y-1 max-h-60 overflow-y-auto">
								<button
									type="button"
									onClick={() => setSelectedStrategyId(null)}
									className={`w-full text-left px-3 py-2 rounded text-sm ${
										selectedStrategyId === null
											? "bg-blue-600/20 border border-blue-500"
											: "hover:bg-gray-800"
									}`}
								>
									Custom strategy (agent writes from scratch)
								</button>
								{filteredStrategies.map((s) => (
									<button
										key={s.id}
										type="button"
										onClick={() => setSelectedStrategyId(s.id)}
										className={`w-full text-left px-3 py-2 rounded text-sm ${
											selectedStrategyId === s.id
												? "bg-blue-600/20 border border-blue-500"
												: "hover:bg-gray-800"
										}`}
									>
										<div>{s.name}</div>
										<div className="text-xs text-gray-500">
											{s.category} / {s.difficulty} / {s.engine}
										</div>
									</button>
								))}
							</div>
						</div>
					)}

					{step === "config" && (
						<div className="space-y-3">
							<label className="block text-xs text-gray-400">
								Budget (USD)
								<input
									type="number"
									value={budget}
									onChange={(e) => setBudget(e.target.value)}
									className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm"
								/>
							</label>
							<label className="block text-xs text-gray-400">
								Target Return %
								<input
									type="number"
									value={targetReturn}
									onChange={(e) => setTargetReturn(e.target.value)}
									className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm"
								/>
							</label>
							<label className="block text-xs text-gray-400">
								Stop Loss %
								<input
									type="number"
									value={stopLoss}
									onChange={(e) => setStopLoss(e.target.value)}
									className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm"
								/>
							</label>
						</div>
					)}

					{step === "launch" && (
						<div className="text-sm space-y-2">
							<div>
								<span className="text-gray-500">Desk:</span> {name}
							</div>
							<div>
								<span className="text-gray-500">Venues:</span> {selectedVenues.join(", ") || "none"}
							</div>
							<div>
								<span className="text-gray-500">Strategy:</span>{" "}
								{selectedStrategy?.name ?? "Custom"}
							</div>
							<div>
								<span className="text-gray-500">Budget:</span> ${budget}
							</div>
							<div>
								<span className="text-gray-500">Target:</span> {targetReturn}%
							</div>
							<div>
								<span className="text-gray-500">Stop Loss:</span> -{stopLoss}%
							</div>
						</div>
					)}
				</div>

				<div className="flex justify-between px-5 py-3 border-t border-gray-800">
					<button
						type="button"
						onClick={() => (stepIndex > 0 ? setStep(steps[stepIndex - 1]!) : onClose())}
						className="px-4 py-2 text-sm text-gray-400 hover:text-white"
					>
						{stepIndex > 0 ? "Back" : "Cancel"}
					</button>
					{step === "launch" ? (
						<button
							type="button"
							onClick={handleSubmit}
							disabled={submitting || !name.trim()}
							className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded text-sm font-medium"
						>
							{submitting ? "Creating..." : "Launch"}
						</button>
					) : (
						<button
							type="button"
							onClick={() => setStep(steps[stepIndex + 1]!)}
							disabled={step === "desk" && !name.trim()}
							className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-sm font-medium"
						>
							Next
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
