import type * as React from "react";
import { cn } from "../../lib/utils.js";

function Card({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn("rounded-lg border bg-card text-card-foreground shadow-xs", className)}
			{...props}
		/>
	);
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
	return <div className={cn("flex flex-col gap-1.5 p-4", className)} {...props} />;
}

function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
	return (
		<h3 className={cn("text-sm font-semibold leading-none tracking-tight", className)} {...props} />
	);
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
	return <p className={cn("text-xs text-muted-foreground", className)} {...props} />;
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
	return <div className={cn("p-4 pt-0", className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent };
