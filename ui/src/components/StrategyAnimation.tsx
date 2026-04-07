/**
 * Category-based SVG micro-animations for strategy detail panel.
 * Each animation is a small chart-like visualization that loops.
 */

const ANIM_W = 280;
const ANIM_H = 120;

function TrendFollowing() {
	return (
		<svg viewBox={`0 0 ${ANIM_W} ${ANIM_H}`} className="w-full h-full">
			<title>Trend following animation</title>
			{/* Grid lines */}
			<line x1="0" y1="60" x2={ANIM_W} y2="60" stroke="currentColor" strokeOpacity="0.08" />
			<line x1="0" y1="30" x2={ANIM_W} y2="30" stroke="currentColor" strokeOpacity="0.05" />
			<line x1="0" y1="90" x2={ANIM_W} y2="90" stroke="currentColor" strokeOpacity="0.05" />

			{/* Uptrend line */}
			<path
				d="M 0,95 Q 40,90 70,75 T 140,55 T 200,35 T 260,15"
				fill="none"
				stroke="rgb(34,197,94)"
				strokeWidth="2.5"
				strokeLinecap="round"
				strokeDasharray="400"
				strokeDashoffset="400"
			>
				<animate
					attributeName="stroke-dashoffset"
					from="400"
					to="0"
					dur="2s"
					fill="freeze"
					repeatCount="indefinite"
				/>
			</path>

			{/* Entry arrows */}
			<g opacity="0">
				<circle cx="70" cy="75" r="4" fill="rgb(34,197,94)" />
				<text x="70" y="69" textAnchor="middle" fontSize="8" fill="rgb(34,197,94)" fontWeight="600">
					BUY
				</text>
				<animate
					attributeName="opacity"
					values="0;0;1;1"
					keyTimes="0;0.3;0.4;1"
					dur="2s"
					repeatCount="indefinite"
				/>
			</g>
			<g opacity="0">
				<circle cx="200" cy="35" r="4" fill="rgb(34,197,94)" />
				<text
					x="200"
					y="29"
					textAnchor="middle"
					fontSize="8"
					fill="rgb(34,197,94)"
					fontWeight="600"
				>
					BUY
				</text>
				<animate
					attributeName="opacity"
					values="0;0;1;1"
					keyTimes="0;0.6;0.7;1"
					dur="2s"
					repeatCount="indefinite"
				/>
			</g>
		</svg>
	);
}

function MeanReversion() {
	// Build a sine wave so marker positions are exact
	const mean = 60;
	const amp = 35;
	const periods = 2.5;
	const points: string[] = [];
	for (let i = 0; i <= 60; i++) {
		const x = (i / 60) * ANIM_W;
		const y = mean - amp * Math.sin((i / 60) * periods * 2 * Math.PI);
		points.push(`${i === 0 ? "M" : "L"} ${x.toFixed(1)},${y.toFixed(1)}`);
	}
	const path = points.join(" ");

	// Helper: get exact (x,y) on sine wave
	const at = (t: number) => {
		const x = t * ANIM_W;
		const y = mean - amp * Math.sin(t * periods * 2 * Math.PI);
		return { x, y };
	};

	const sell1 = at(0.1); // first peak (top)
	const buy1 = at(0.3); // first trough (bottom)
	const sell2 = at(0.5); // second peak
	const buy2 = at(0.7); // second trough

	return (
		<svg viewBox={`0 0 ${ANIM_W} ${ANIM_H}`} className="w-full h-full">
			<title>Mean reversion animation</title>
			{/* Mean line */}
			<line
				x1="0"
				y1={mean}
				x2={ANIM_W}
				y2={mean}
				stroke="currentColor"
				strokeOpacity="0.15"
				strokeDasharray="4 4"
			/>
			<text
				x={ANIM_W - 4}
				y={mean - 4}
				textAnchor="end"
				fontSize="8"
				fill="currentColor"
				opacity="0.3"
			>
				mean
			</text>

			{/* Oscillating price */}
			<path
				d={path}
				fill="none"
				stroke="rgb(59,130,246)"
				strokeWidth="2.5"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeDasharray="600"
				strokeDashoffset="600"
			>
				<animate
					attributeName="stroke-dashoffset"
					from="600"
					to="0"
					dur="2.5s"
					fill="freeze"
					repeatCount="indefinite"
				/>
			</path>

			{/* Sell at peaks */}
			<g opacity="0">
				<circle cx={sell1.x} cy={sell1.y} r="3.5" fill="rgb(239,68,68)" />
				<text
					x={sell1.x}
					y={sell1.y - 6}
					textAnchor="middle"
					fontSize="7"
					fill="rgb(239,68,68)"
					fontWeight="600"
				>
					SELL
				</text>
				<animate
					attributeName="opacity"
					values="0;0;1;1"
					keyTimes="0;0.15;0.2;1"
					dur="2.5s"
					repeatCount="indefinite"
				/>
			</g>
			<g opacity="0">
				<circle cx={sell2.x} cy={sell2.y} r="3.5" fill="rgb(239,68,68)" />
				<text
					x={sell2.x}
					y={sell2.y - 6}
					textAnchor="middle"
					fontSize="7"
					fill="rgb(239,68,68)"
					fontWeight="600"
				>
					SELL
				</text>
				<animate
					attributeName="opacity"
					values="0;0;1;1"
					keyTimes="0;0.55;0.6;1"
					dur="2.5s"
					repeatCount="indefinite"
				/>
			</g>

			{/* Buy at troughs */}
			<g opacity="0">
				<circle cx={buy1.x} cy={buy1.y} r="3.5" fill="rgb(34,197,94)" />
				<text
					x={buy1.x}
					y={buy1.y + 12}
					textAnchor="middle"
					fontSize="7"
					fill="rgb(34,197,94)"
					fontWeight="600"
				>
					BUY
				</text>
				<animate
					attributeName="opacity"
					values="0;0;1;1"
					keyTimes="0;0.35;0.4;1"
					dur="2.5s"
					repeatCount="indefinite"
				/>
			</g>
			<g opacity="0">
				<circle cx={buy2.x} cy={buy2.y} r="3.5" fill="rgb(34,197,94)" />
				<text
					x={buy2.x}
					y={buy2.y + 12}
					textAnchor="middle"
					fontSize="7"
					fill="rgb(34,197,94)"
					fontWeight="600"
				>
					BUY
				</text>
				<animate
					attributeName="opacity"
					values="0;0;1;1"
					keyTimes="0;0.75;0.8;1"
					dur="2.5s"
					repeatCount="indefinite"
				/>
			</g>
		</svg>
	);
}

function MarketMaking() {
	return (
		<svg viewBox={`0 0 ${ANIM_W} ${ANIM_H}`} className="w-full h-full">
			<title>Market making animation</title>
			{/* Mid price */}
			<line x1="0" y1="60" x2={ANIM_W} y2="60" stroke="currentColor" strokeOpacity="0.1" />

			{/* Ask line (top) */}
			<path
				d="M 0,40 L 60,42 L 120,38 L 180,41 L 240,39 L 280,40"
				fill="none"
				stroke="rgb(239,68,68)"
				strokeWidth="1.5"
				strokeOpacity="0.6"
				strokeDasharray="400"
				strokeDashoffset="400"
			>
				<animate
					attributeName="stroke-dashoffset"
					from="400"
					to="0"
					dur="1.5s"
					fill="freeze"
					repeatCount="indefinite"
				/>
			</path>
			<text x="4" y="36" fontSize="7" fill="rgb(239,68,68)" opacity="0.6">
				ASK
			</text>

			{/* Bid line (bottom) */}
			<path
				d="M 0,80 L 60,78 L 120,82 L 180,79 L 240,81 L 280,80"
				fill="none"
				stroke="rgb(34,197,94)"
				strokeWidth="1.5"
				strokeOpacity="0.6"
				strokeDasharray="400"
				strokeDashoffset="400"
			>
				<animate
					attributeName="stroke-dashoffset"
					from="400"
					to="0"
					dur="1.5s"
					fill="freeze"
					repeatCount="indefinite"
				/>
			</path>
			<text x="4" y="90" fontSize="7" fill="rgb(34,197,94)" opacity="0.6">
				BID
			</text>

			{/* Spread fill that pulses */}
			<rect x="0" y="40" width={ANIM_W} height="40" fill="currentColor" opacity="0.03">
				<animate
					attributeName="opacity"
					values="0.03;0.07;0.03"
					dur="2s"
					repeatCount="indefinite"
				/>
			</rect>

			{/* Spread label */}
			<g opacity="0">
				<text
					x="140"
					y="63"
					textAnchor="middle"
					fontSize="9"
					fill="currentColor"
					opacity="0.4"
					fontWeight="500"
				>
					SPREAD
				</text>
				<animate
					attributeName="opacity"
					values="0;0;1;1"
					keyTimes="0;0.4;0.6;1"
					dur="1.5s"
					repeatCount="indefinite"
				/>
			</g>
		</svg>
	);
}

function Momentum() {
	return (
		<svg viewBox={`0 0 ${ANIM_W} ${ANIM_H}`} className="w-full h-full">
			<title>Momentum animation</title>
			<line x1="0" y1="60" x2={ANIM_W} y2="60" stroke="currentColor" strokeOpacity="0.08" />

			{/* Slow start, accelerating curve */}
			<path
				d="M 10,100 C 40,98 60,95 90,85 S 150,55 190,30 S 250,8 270,5"
				fill="none"
				stroke="rgb(168,85,247)"
				strokeWidth="2.5"
				strokeLinecap="round"
				strokeDasharray="400"
				strokeDashoffset="400"
			>
				<animate
					attributeName="stroke-dashoffset"
					from="400"
					to="0"
					dur="1.8s"
					fill="freeze"
					repeatCount="indefinite"
				/>
			</path>

			{/* Momentum bar indicators */}
			{[
				{ x: 50, h: 12 },
				{ x: 90, h: 22 },
				{ x: 130, h: 35 },
				{ x: 170, h: 50 },
				{ x: 210, h: 65 },
			].map((bar, i) => (
				<rect
					key={bar.x}
					x={bar.x}
					y={ANIM_H - bar.h}
					width="20"
					height={bar.h}
					rx="2"
					fill="rgb(168,85,247)"
					opacity="0"
				>
					<animate
						attributeName="opacity"
						values="0;0;0.15;0.15"
						keyTimes={`0;${0.15 + i * 0.1};${0.25 + i * 0.1};1`}
						dur="1.8s"
						repeatCount="indefinite"
					/>
				</rect>
			))}
		</svg>
	);
}

function Arbitrage() {
	return (
		<svg viewBox={`0 0 ${ANIM_W} ${ANIM_H}`} className="w-full h-full">
			<title>Arbitrage animation</title>
			{/* Exchange A price */}
			<path
				d="M 0,30 Q 40,25 80,35 T 160,40 T 240,50 L 280,55"
				fill="none"
				stroke="rgb(59,130,246)"
				strokeWidth="2"
				strokeLinecap="round"
				strokeDasharray="400"
				strokeDashoffset="400"
			>
				<animate
					attributeName="stroke-dashoffset"
					from="400"
					to="0"
					dur="2s"
					fill="freeze"
					repeatCount="indefinite"
				/>
			</path>
			<text x="4" y="26" fontSize="7" fill="rgb(59,130,246)" opacity="0.6">
				Exchange A
			</text>

			{/* Exchange B price */}
			<path
				d="M 0,80 Q 40,85 80,75 T 160,65 T 240,58 L 280,55"
				fill="none"
				stroke="rgb(245,158,11)"
				strokeWidth="2"
				strokeLinecap="round"
				strokeDasharray="400"
				strokeDashoffset="400"
			>
				<animate
					attributeName="stroke-dashoffset"
					from="400"
					to="0"
					dur="2s"
					fill="freeze"
					repeatCount="indefinite"
				/>
			</path>
			<text x="4" y="94" fontSize="7" fill="rgb(245,158,11)" opacity="0.6">
				Exchange B
			</text>

			{/* Convergence arrows */}
			<g opacity="0">
				<line
					x1="80"
					y1="35"
					x2="80"
					y2="75"
					stroke="currentColor"
					strokeWidth="1"
					strokeDasharray="3 2"
					strokeOpacity="0.3"
				/>
				<text x="86" y="58" fontSize="7" fill="currentColor" opacity="0.4">
					arb
				</text>
				<animate
					attributeName="opacity"
					values="0;0;1;1"
					keyTimes="0;0.25;0.35;1"
					dur="2s"
					repeatCount="indefinite"
				/>
			</g>
			<g opacity="0">
				<line
					x1="160"
					y1="40"
					x2="160"
					y2="65"
					stroke="currentColor"
					strokeWidth="1"
					strokeDasharray="3 2"
					strokeOpacity="0.3"
				/>
				<text x="166" y="55" fontSize="7" fill="currentColor" opacity="0.4">
					arb
				</text>
				<animate
					attributeName="opacity"
					values="0;0;1;1"
					keyTimes="0;0.5;0.6;1"
					dur="2s"
					repeatCount="indefinite"
				/>
			</g>
		</svg>
	);
}

function Scalping() {
	return (
		<svg viewBox={`0 0 ${ANIM_W} ${ANIM_H}`} className="w-full h-full">
			<title>Scalping animation</title>
			<line x1="0" y1="60" x2={ANIM_W} y2="60" stroke="currentColor" strokeOpacity="0.08" />

			{/* Rapid small trades */}
			<path
				d="M 0,60 L 20,55 L 35,62 L 50,52 L 65,58 L 80,48 L 95,56 L 110,46 L 130,54 L 150,44 L 165,52 L 180,42 L 200,50 L 220,40 L 240,48 L 260,38 L 280,45"
				fill="none"
				stroke="rgb(6,182,212)"
				strokeWidth="2"
				strokeLinecap="round"
				strokeDasharray="500"
				strokeDashoffset="500"
			>
				<animate
					attributeName="stroke-dashoffset"
					from="500"
					to="0"
					dur="1.5s"
					fill="freeze"
					repeatCount="indefinite"
				/>
			</path>

			{/* Quick entry/exit pairs */}
			{[35, 95, 165, 240].map((x, i) => (
				<g key={x} opacity="0">
					<circle cx={x} cy={60 - (i % 2 === 0 ? 2 : 8)} r="2.5" fill="rgb(6,182,212)" />
					<animate
						attributeName="opacity"
						values="0;0;1;0.5"
						keyTimes={`0;${0.1 + i * 0.15};${0.2 + i * 0.15};1`}
						dur="1.5s"
						repeatCount="indefinite"
					/>
				</g>
			))}
		</svg>
	);
}

function Volatility() {
	return (
		<svg viewBox={`0 0 ${ANIM_W} ${ANIM_H}`} className="w-full h-full">
			<title>Volatility animation</title>
			{/* Bollinger-like bands */}
			<path
				d="M 0,20 Q 70,10 140,15 T 280,18"
				fill="none"
				stroke="currentColor"
				strokeOpacity="0.15"
				strokeWidth="1"
				strokeDasharray="400"
				strokeDashoffset="400"
			>
				<animate
					attributeName="stroke-dashoffset"
					from="400"
					to="0"
					dur="2s"
					fill="freeze"
					repeatCount="indefinite"
				/>
			</path>
			<path
				d="M 0,100 Q 70,110 140,105 T 280,102"
				fill="none"
				stroke="currentColor"
				strokeOpacity="0.15"
				strokeWidth="1"
				strokeDasharray="400"
				strokeDashoffset="400"
			>
				<animate
					attributeName="stroke-dashoffset"
					from="400"
					to="0"
					dur="2s"
					fill="freeze"
					repeatCount="indefinite"
				/>
			</path>

			{/* Band fill */}
			<path
				d="M 0,20 Q 70,10 140,15 T 280,18 L 280,102 Q 210,107 140,105 T 0,100 Z"
				fill="currentColor"
				opacity="0.04"
			/>

			{/* Price bouncing within bands */}
			<path
				d="M 0,60 Q 20,25 50,55 T 100,95 T 150,30 T 200,85 T 250,40 L 280,60"
				fill="none"
				stroke="rgb(245,158,11)"
				strokeWidth="2.5"
				strokeLinecap="round"
				strokeDasharray="500"
				strokeDashoffset="500"
			>
				<animate
					attributeName="stroke-dashoffset"
					from="500"
					to="0"
					dur="2.5s"
					fill="freeze"
					repeatCount="indefinite"
				/>
			</path>
		</svg>
	);
}

function DefaultAnimation() {
	return (
		<svg viewBox={`0 0 ${ANIM_W} ${ANIM_H}`} className="w-full h-full">
			<title>Strategy animation</title>
			<line x1="0" y1="60" x2={ANIM_W} y2="60" stroke="currentColor" strokeOpacity="0.08" />
			<path
				d="M 0,80 Q 50,70 100,50 T 200,40 T 280,30"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeOpacity="0.2"
				strokeLinecap="round"
				strokeDasharray="400"
				strokeDashoffset="400"
			>
				<animate
					attributeName="stroke-dashoffset"
					from="400"
					to="0"
					dur="2s"
					fill="freeze"
					repeatCount="indefinite"
				/>
			</path>
		</svg>
	);
}

const animationMap: Record<string, () => JSX.Element> = {
	trend_following: TrendFollowing,
	mean_reversion: MeanReversion,
	market_making: MarketMaking,
	momentum: Momentum,
	arbitrage: Arbitrage,
	scalping: Scalping,
	volatility: Volatility,
	ml_based: DefaultAnimation,
	multi_indicator: DefaultAnimation,
	pattern: DefaultAnimation,
	execution: DefaultAnimation,
};

export function StrategyAnimation({ category }: { category: string }) {
	const Component = animationMap[category] ?? DefaultAnimation;
	return (
		<div className="rounded-lg border border-border/50 bg-muted/30 p-3 overflow-hidden">
			<Component />
		</div>
	);
}
