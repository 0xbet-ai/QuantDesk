import type { SVGProps } from "react";

export function DeskIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			{...props}
		>
			{/* Desktop surface */}
			<rect x="2" y="7" width="20" height="3" rx="1" />
			{/* Left leg */}
			<path d="M4 10v7" />
			{/* Right leg */}
			<path d="M20 10v7" />
			{/* Drawer */}
			<path d="M8 10v4h8v-4" />
			{/* Drawer handle */}
			<line x1="10.5" y1="12" x2="13.5" y2="12" />
		</svg>
	);
}
