import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/utils.js";

interface Props {
	label: string;
	icon: LucideIcon;
	active?: boolean;
	badge?: number;
	onClick?: () => void;
}

export function SidebarNavItem({ label, icon: Icon, active, badge, onClick }: Props) {
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
			<Icon className="h-4 w-4 shrink-0" />
			<span className="flex-1 truncate">{label}</span>
			{badge != null && badge > 0 && (
				<span className="ml-auto rounded-full px-1.5 py-0.5 text-xs leading-none bg-primary text-primary-foreground">
					{badge}
				</span>
			)}
		</button>
	);
}
