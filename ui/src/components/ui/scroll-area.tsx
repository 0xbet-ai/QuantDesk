import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import type * as React from "react";
import { cn } from "../../lib/utils.js";

function ScrollArea({
	className,
	children,
	...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
	return (
		<ScrollAreaPrimitive.Root className={cn("relative overflow-hidden", className)} {...props}>
			<ScrollAreaPrimitive.Viewport className="h-full w-full rounded-[inherit]">
				{children}
			</ScrollAreaPrimitive.Viewport>
			<ScrollAreaPrimitive.Scrollbar
				orientation="vertical"
				className="flex touch-none select-none p-0.5 transition-colors data-[orientation=vertical]:w-2"
			>
				<ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-border" />
			</ScrollAreaPrimitive.Scrollbar>
			<ScrollAreaPrimitive.Scrollbar
				orientation="horizontal"
				className="flex touch-none select-none p-0.5 transition-colors data-[orientation=horizontal]:h-2 data-[orientation=horizontal]:flex-col"
			>
				<ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-border" />
			</ScrollAreaPrimitive.Scrollbar>
			<ScrollAreaPrimitive.Corner />
		</ScrollAreaPrimitive.Root>
	);
}

export { ScrollArea };
