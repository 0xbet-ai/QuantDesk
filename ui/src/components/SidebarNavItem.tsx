import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/utils.js";

interface Props {
	label: string;
	icon: LucideIcon;
	active?: boolean;
	badge?: number;
	/** Show a small pulsing dot on the icon to indicate new content. */
	hasUpdate?: boolean;
	onClick?: () => void;
}

export function SidebarNavItem({ label, icon: Icon, active, badge, hasUpdate, onClick }: Props) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium transition-colors w-full text-left",
				active
					? "bg-accent text-foreground"
					: "text-foreground/80 hover:bg-accent/50 hover:text-foreground",
			)}
		>
			<div className="relative shrink-0">
				<Icon className="h-4 w-4" />
				{hasUpdate && !active && (
					<span className="absolute -top-0.5 -right-0.5 flex h-1.5 w-1.5">
						<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-500 opacity-75" />
						<span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue-500" />
					</span>
				)}
			</div>
			<span className="flex-1 truncate">{label}</span>
			{badge != null && badge > 0 && (
				<span className="ml-auto rounded-full px-1.5 py-0.5 text-xs leading-none bg-primary text-primary-foreground">
					{badge}
				</span>
			)}
		</button>
	);
}
