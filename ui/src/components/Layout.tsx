import { ChevronLeft, ChevronRight, Globe, Menu, Moon, PanelRight, Plus, Sun, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { supportedLanguages } from "../i18n.js";
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
	const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
	const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
	const { theme, toggleTheme } = useTheme();
	const { t, i18n } = useTranslation();
	const nextTheme = theme === "dark" ? "light" : "dark";

	const cycleLang = () => {
		const codes: string[] = supportedLanguages.map((l) => l.code);
		const idx = codes.indexOf(i18n.language);
		const next = codes[(idx + 1) % codes.length]!;
		i18n.changeLanguage(next);
		localStorage.setItem("quantdesk.lang", next);
	};
	const currentLangLabel = supportedLanguages.find((l) => l.code === i18n.language)?.label ?? "EN";

	return (
		<div className="flex h-screen bg-background text-foreground">
			{/* ── Mobile top bar ──────────────────────────────────── */}
			<div className="lg:hidden fixed top-0 left-0 right-0 z-30 h-12 bg-background border-b border-border flex items-center px-3 gap-2">
				<Button variant="ghost" size="icon-sm" onClick={() => setMobileMenuOpen(true)}>
					<Menu className="size-4" />
				</Button>
				<span className="text-sm font-semibold truncate flex-1">
					{selectedDesk?.name ?? t("layout.appName")}
				</span>
				{selectedExperiment && panel && (
					<Button variant="ghost" size="icon-sm" onClick={() => setMobilePanelOpen(true)}>
						<PanelRight className="size-4" />
					</Button>
				)}
				<Button variant="ghost" size="icon-sm" onClick={cycleLang}>
					<Globe className="size-4" />
				</Button>
				<Button variant="ghost" size="icon-sm" onClick={toggleTheme}>
					{theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
				</Button>
			</div>

			{/* ── Mobile sidebar overlay ──────────────────────────── */}
			{mobileMenuOpen && (
				<div className="lg:hidden fixed inset-0 z-40 flex">
					{/* Backdrop */}
					<div
						className="absolute inset-0 bg-black/40"
						onClick={() => setMobileMenuOpen(false)}
						onKeyDown={() => {}}
						role="presentation"
					/>
					{/* Drawer */}
					<div className="relative w-72 max-w-[85vw] bg-background border-r border-border flex flex-col animate-in slide-in-from-left duration-200">
						<div className="flex items-center justify-between px-3 py-3 border-b border-border">
							<span className="text-sm font-semibold">{t("layout.appName")}</span>
							<Button variant="ghost" size="icon-sm" onClick={() => setMobileMenuOpen(false)}>
								<X className="size-4" />
							</Button>
						</div>
						<div className="flex-1 overflow-y-auto">
							{/* Desks list */}
							<nav className="flex flex-col gap-4 px-3 py-2">
								<button
									type="button"
									onClick={() => {
										onNewDesk();
										setMobileMenuOpen(false);
									}}
									className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-foreground/70 hover:bg-accent/50 hover:text-foreground transition-colors w-full text-left"
								>
									<Plus className="h-4 w-4 shrink-0" />
									<span>{t("layout.newDesk")}</span>
								</button>
								<SidebarSection label="Desks">
									{desks.map((desk) => (
										<button
											key={desk.id}
											type="button"
											onClick={() => {
												onSelectDesk(desk.id);
												setMobileMenuOpen(false);
											}}
											className={cn(
												"flex items-center gap-2.5 px-3 py-2 text-xs font-medium transition-colors w-full text-left",
												desk.id === selectedDesk?.id
													? "bg-accent text-foreground"
													: "text-foreground/80 hover:bg-accent/50",
											)}
										>
											<DeskIcon className="h-4 w-4 shrink-0" />
											<span className="truncate">{desk.name}</span>
										</button>
									))}
								</SidebarSection>
							</nav>
							{/* DeskPanel (sidebar) inside mobile drawer */}
							{selectedDesk && <div className="border-t border-border">{sidebar}</div>}
						</div>
					</div>
				</div>
			)}

			{/* ── Mobile properties bottom sheet ─────────────────── */}
			{mobilePanelOpen && selectedExperiment && panel && (
				<div className="lg:hidden fixed inset-0 z-40 flex flex-col justify-end">
					<div
						className="absolute inset-0 bg-black/40"
						onClick={() => setMobilePanelOpen(false)}
						onKeyDown={() => {}}
						role="presentation"
					/>
					<div className="relative bg-background border-t border-border rounded-t-xl max-h-[80vh] flex flex-col animate-in slide-in-from-bottom duration-200">
						<div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
							<span className="text-sm font-medium">{t("layout.properties")}</span>
							<Button variant="ghost" size="icon-sm" onClick={() => setMobilePanelOpen(false)}>
								<X className="size-4" />
							</Button>
						</div>
						<ScrollArea className="flex-1">{panel}</ScrollArea>
					</div>
				</div>
			)}

			{/* ── Desktop: Col 1 — Desks sidebar ─────────────────── */}
			<aside
				className={cn(
					"hidden lg:flex h-full min-h-0 border-r border-border bg-background flex-col transition-all duration-100 ease-out",
					sidebarOpen ? "w-60" : "w-0 overflow-hidden",
				)}
			>
				<div className="px-3 h-3 shrink-0" />
				<nav className="flex-1 min-h-0 overflow-y-auto scrollbar-auto-hide flex flex-col gap-4 px-3 py-2">
					<div className="flex flex-col gap-0.5">
						<button
							type="button"
							onClick={onNewDesk}
							className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-foreground/70 hover:bg-accent/50 hover:text-foreground transition-colors w-full text-left"
						>
							<Plus className="h-4 w-4 shrink-0" />
							<span className="truncate">{t("layout.newDesk")}</span>
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
							<div className="px-3 py-2 text-xs text-muted-foreground">{t("layout.noDesks")}</div>
						)}
					</SidebarSection>
					<div className="flex-1" />
				</nav>
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
					<Button
						variant="ghost"
						size="icon-sm"
						className="text-muted-foreground"
						onClick={cycleLang}
						title={`Language: ${currentLangLabel}`}
					>
						<Globe className="h-4 w-4" />
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

			{/* Desktop: collapsed sidebar toggle */}
			{!sidebarOpen && (
				<div className="hidden lg:flex items-start pt-3 px-1 border-r border-border">
					<Button variant="ghost" size="icon-xs" onClick={() => setSidebarOpen(true)}>
						<ChevronRight className="size-4" />
					</Button>
				</div>
			)}

			{/* ── Desktop: Col 2 — DeskPanel ─────────────────────── */}
			{selectedDesk && (
				<div className="hidden lg:flex w-56 shrink-0 border-r border-border flex-col">
					{sidebar}
				</div>
			)}

			{/* ── Col 3 — Main content (always visible) ──────────── */}
			<div className="flex-1 flex flex-col min-w-0 pt-12 lg:pt-0">{main}</div>

			{/* ── Desktop: Properties panel ───────────────────────── */}
			{selectedExperiment && panel && (
				<>
					{!panelOpen && (
						<div className="hidden lg:flex items-start pt-3 px-1 border-l border-border">
							<Button variant="ghost" size="icon-xs" onClick={() => setPanelOpen(true)}>
								<PanelRight className="size-4" />
							</Button>
						</div>
					)}
					{panelOpen && (
						<div className="hidden lg:flex w-80 min-w-[320px] shrink-0 border-l border-border flex-col">
							<div className="flex items-center justify-between px-4 h-12 border-b border-border shrink-0">
								<span className="text-sm font-medium">{t("layout.properties")}</span>
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
