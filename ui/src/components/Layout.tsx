import { ChevronLeft, ChevronRight, Moon, PanelRight, Plus, Settings, Sun } from "lucide-react";
import { useState } from "react";
import { useTheme } from "../context/ThemeContext.js";
import type { Desk, Experiment } from "../lib/api.js";
import { cn } from "../lib/utils.js";
import { SidebarSection } from "./SidebarSection.js";
import { DeskIcon } from "./icons/DeskIcon.js";
import { Button } from "./ui/button.js";
import { ScrollArea } from "./ui/scroll-area.js";

interface LayoutProps {
	desks: Desk[];
	selectedDesk: Desk | null;
	selectedExperiment: Experiment | null;
	onSelectDesk: (id: string) => void;
	onNewDesk: () => void;
	sidebar: React.ReactNode;
	main: React.ReactNode;
	panel: React.ReactNode;
}

export function Layout({
	desks,
	selectedDesk,
	selectedExperiment,
	onSelectDesk,
	onNewDesk,
	sidebar,
	main,
	panel,
}: LayoutProps) {
	const [sidebarOpen, setSidebarOpen] = useState(true);
	const [panelOpen, setPanelOpen] = useState(true);
	const { theme, toggleTheme } = useTheme();
	const nextTheme = theme === "dark" ? "light" : "dark";

	return (
		<div className="flex h-screen bg-background text-foreground">
			{/* Col 1 */}
			<aside
				className={cn(
					"h-full min-h-0 border-r border-border bg-background flex flex-col transition-all duration-100 ease-out",
					sidebarOpen ? "w-60" : "w-0 overflow-hidden",
				)}
			>
				{/* Top bar — logo placeholder */}
				<div className="px-3 h-3 shrink-0" />

				{/* Nav — Paperclip structure */}
				<nav className="flex-1 min-h-0 overflow-y-auto scrollbar-auto-hide flex flex-col gap-4 px-3 py-2">
					<div className="flex flex-col gap-0.5">
						<button
							type="button"
							onClick={onNewDesk}
							className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors w-full text-left"
						>
							<Plus className="h-4 w-4 shrink-0" />
							<span className="truncate">New Desk</span>
						</button>
					</div>

					<SidebarSection label="Desks">
						{desks.map((desk) => (
							<button
								key={desk.id}
								type="button"
								onClick={() => onSelectDesk(desk.id)}
								className={cn(
									"flex items-center gap-2.5 px-3 py-2 text-xs font-medium transition-colors w-full text-left",
									desk.id === selectedDesk?.id
										? "bg-accent text-foreground"
										: "text-foreground/80 hover:bg-accent/50 hover:text-foreground",
								)}
							>
								<DeskIcon className="h-4 w-4 shrink-0" />
								<span className="flex-1 truncate">{desk.name}</span>
							</button>
						))}
						{desks.length === 0 && (
							<div className="px-3 py-2 text-xs text-muted-foreground">No desks yet</div>
						)}
					</SidebarSection>

					<div className="flex-1" />
				</nav>

				{/* Footer */}
				<div className="flex items-center gap-1 px-3 py-2 border-t border-border shrink-0">
					<Button
						variant="ghost"
						size="icon-sm"
						className="text-muted-foreground"
						onClick={() => setSidebarOpen(false)}
					>
						<ChevronLeft className="h-4 w-4" />
					</Button>
					<div className="flex-1" />
					<Button variant="ghost" size="icon-sm" className="text-muted-foreground" title="Settings">
						<Settings className="h-4 w-4" />
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						className="text-muted-foreground"
						onClick={toggleTheme}
						title={`Switch to ${nextTheme} mode`}
					>
						{theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
					</Button>
				</div>
			</aside>

			{/* Collapsed sidebar toggle */}
			{!sidebarOpen && (
				<div className="flex items-start pt-3 px-1 border-r border-border">
					<Button variant="ghost" size="icon-xs" onClick={() => setSidebarOpen(true)}>
						<ChevronRight className="size-4" />
					</Button>
				</div>
			)}

			{/* Col 2: Selected desk config + experiment list + live list */}
			{selectedDesk && (
				<div className="w-56 shrink-0 border-r border-border flex flex-col">{sidebar}</div>
			)}

			{/* Col 3: Comment thread */}
			<div className="flex-1 flex flex-col min-w-0">{main}</div>

			{/* Props Panel */}
			{selectedExperiment && (
				<>
					{!panelOpen && (
						<div className="flex items-start pt-3 px-1 border-l border-border">
							<Button variant="ghost" size="icon-xs" onClick={() => setPanelOpen(true)}>
								<PanelRight className="size-4" />
							</Button>
						</div>
					)}
					{panelOpen && (
						<div className="w-80 min-w-[320px] shrink-0 border-l border-border flex flex-col">
							<div className="flex items-center justify-between px-4 h-12 border-b border-border shrink-0">
								<span className="text-sm font-medium">Properties</span>
								<Button variant="ghost" size="icon-xs" onClick={() => setPanelOpen(false)}>
									<PanelRight className="size-4" />
								</Button>
							</div>
							<ScrollArea className="flex-1">{panel}</ScrollArea>
						</div>
					)}
				</>
			)}
		</div>
	);
}
