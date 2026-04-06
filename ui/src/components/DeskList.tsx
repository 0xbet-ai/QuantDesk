import type { Desk } from "../lib/api.js";

interface Props {
	desks: Desk[];
	selectedId: string | null;
	onSelect: (id: string) => void;
}

export function DeskList({ desks, selectedId, onSelect }: Props) {
	return (
		<div className="flex-1 overflow-y-auto">
			<div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Desks</div>
			{desks.map((desk) => (
				<button
					key={desk.id}
					type="button"
					onClick={() => onSelect(desk.id)}
					className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-800 ${
						desk.id === selectedId ? "bg-gray-800 text-white" : "text-gray-300"
					}`}
				>
					{desk.name}
				</button>
			))}
			{desks.length === 0 && <div className="px-3 py-2 text-sm text-gray-600">No desks yet</div>}
		</div>
	);
}
