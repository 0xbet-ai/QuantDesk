import type { ReactNode } from "react";

interface Props {
	label: string;
	action?: ReactNode;
	children: ReactNode;
}

export function SidebarSection({ label, action, children }: Props) {
	return (
		<div>
			<div className="flex items-center justify-between px-3 py-1.5">
				<span className="text-[10px] font-medium uppercase tracking-widest font-mono text-foreground/40">
					{label}
				</span>
				{action}
			</div>
			<div className="flex flex-col gap-0.5 mt-0.5">{children}</div>
		</div>
	);
}
