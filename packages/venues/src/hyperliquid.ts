import type { VenueGuide } from "./types.js";

export const hyperliquidGuide: VenueGuide = {
	venue: "hyperliquid",
	displayName: "Hyperliquid",

	tldr:
		"Use ccxt's `fetch_ohlcv` with exchange ID `hyperliquid`. Returns up to " +
		"5000 candles per request (generous). USDC-native DEX — no USDT. " +
		"If ccxt fails, POST to `https://api.hyperliquid.xyz/info` with " +
		"`{\"type\": \"candleSnapshot\", ...}` body.",

	symbolFormat: {
		spot:
			"BTC/USDC, PURR/USDC (ccxt) | @1, @2 (native API uses numeric asset indices, not symbols)",
		linearFutures:
			"BTC/USDC:USDC, ETH/USDC:USDC (ccxt) | BTC, ETH (native API uses bare coin name)",
		notes:
			"USDC is the only quote/settle currency. No USDT, no USD, no EUR. " +
			"Spot: 271 USDC pairs. Linear perps: 294 USDC, 53 USDH, 25 USDE. " +
			"Native API uses bare coin names for perps (BTC) and numeric indices for spot (@1). " +
			"DEX — uses wallet private key, not traditional API key.\n\n" +
			"**Nautilus symbols:** Perp `BTC-USD-PERP.HYPERLIQUID`, " +
			"Spot `BTC-USDC-SPOT.HYPERLIQUID`. Tardis key: `hyperliquid`.",
	},

	recommendedFetch: {
		language: "python",
		library: "ccxt>=4.3",
		code: [
			"import ccxt, time",
			"",
			"ex = ccxt.hyperliquid({'enableRateLimit': True})",
			"ex.load_markets()",
			"",
			"symbol = 'BTC/USDC:USDC'   # perps (most common)",
			"# symbol = 'BTC/USDC'      # spot",
			"timeframe = '5m'",
			"since = ex.parse8601('2024-01-01T00:00:00Z')",
			"all_candles = []",
			"",
			"while True:",
			"    candles = ex.fetch_ohlcv(symbol, timeframe, since=since, limit=5000)",
			"    if not candles:",
			"        break",
			"    all_candles.extend(candles)",
			"    since = candles[-1][0] + 1",
			"    time.sleep(ex.rateLimit / 1000)",
		].join("\n"),
	},

	pagination:
		"Max 5000 candles per request (generous vs other exchanges). " +
		"Advance `since = candles[-1][0] + 1`. " +
		"Rate limit: 1200 req / min. No auth needed for market data.",

	knownGotchas: [
		"USDC-native DEX — no USDT at all. All pairs are USDC-denominated.",
		"Does not support real market orders — freqtrade simulates via limit with 5% slippage.",
		"Only ~5000 historic candles available via API — limited history depth.",
		"Uses wallet private key for auth, not API key. Create a dedicated API wallet.",
		"Native API for perps uses bare coin name (BTC), spot uses numeric index (@1). ccxt normalises both.",
		"REST API (info endpoint): https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/candle-snapshot",
		"Bulk data: s3://hyperliquid-archive/ — L2 book snapshots only (no klines). Requester-pays, monthly updates.",
	],

	lastVerified: "2026-04-09",
	verificationNotes:
		"BTC/USDC:USDC perps 5m, 5000 rows, ccxt 4.4.x. Spot BTC/USDC verified separately.",
};
