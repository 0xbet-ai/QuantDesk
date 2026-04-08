/**
 * QuantDesk MCP server — phase 27b.
 *
 * Tools registered:
 *   - data_fetch        (replaces [DATA_FETCH] marker)
 *   - register_dataset  (replaces [DATASET] marker)
 *
 * Both tools delegate to existing services so the marker dispatch path
 * in `agent-trigger.ts` stays live as a fallback until phase 27d rips
 * the parsers out. Turn context (experimentId / deskId) is captured by
 * the factory closure.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { db } from "@quantdesk/db";
import { datasets, deskDatasets } from "@quantdesk/db/schema";
import { z } from "zod";
import { executeDataFetch } from "../services/data-fetch.js";

export interface McpServerContext {
	experimentId: string;
	deskId: string;
}

export function createQuantdeskMcpServer(ctx: McpServerContext): McpServer {
	const server = new McpServer(
		{
			name: "quantdesk",
			version: "0.0.1",
		},
		{
			capabilities: {
				tools: {},
			},
		},
	);

	// ── data_fetch ────────────────────────────────────────────────────
	server.registerTool(
		"data_fetch",
		{
			description:
				"Download market data (OHLCV) for this desk. Blocks until the " +
				"download finishes and returns the registered dataset summary. " +
				"Requires that the user has already agreed to the exchange, " +
				"pairs, timeframe, and window in the preceding conversation " +
				"(CLAUDE.md rule #13).",
			inputSchema: {
				exchange: z.string().min(1),
				pairs: z.array(z.string().min(1)).min(1),
				timeframe: z.string().min(1),
				days: z.number().int().positive(),
				tradingMode: z.enum(["spot", "margin", "futures"]).optional(),
				rationale: z.string().optional(),
			},
		},
		async (args) => {
			try {
				const dataset = await executeDataFetch({
					experimentId: ctx.experimentId,
					proposal: {
						exchange: args.exchange,
						pairs: args.pairs,
						timeframe: args.timeframe,
						days: args.days,
						tradingMode: args.tradingMode ?? "spot",
						rationale: args.rationale ?? "",
					},
				});
				if (!dataset) {
					return {
						isError: true,
						content: [
							{
								type: "text",
								text: "data_fetch: no dataset produced (download failed or mode has no server-side fetcher). Read the system comment posted to the experiment for details.",
							},
						],
					};
				}
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									datasetId: dataset.id,
									exchange: dataset.exchange,
									pairs: dataset.pairs,
									timeframe: dataset.timeframe,
									dateRange: dataset.dateRange,
									path: dataset.path,
								},
								null,
								2,
							),
						},
					],
				};
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					isError: true,
					content: [{ type: "text", text: `data_fetch failed: ${msg}` }],
				};
			}
		},
	);

	// ── register_dataset ──────────────────────────────────────────────
	server.registerTool(
		"register_dataset",
		{
			description:
				"Register a dataset that already exists on disk (typically " +
				"produced by a workspace-local download script) and link it " +
				"to the current desk. Use this when the agent downloaded data " +
				"itself instead of calling data_fetch.",
			inputSchema: {
				exchange: z.string().min(1),
				pairs: z.array(z.string().min(1)).min(1),
				timeframe: z.string().min(1),
				dateRange: z.object({
					start: z.string().min(1),
					end: z.string().min(1),
				}),
				path: z.string().min(1),
			},
		},
		async (args) => {
			try {
				const [inserted] = await db
					.insert(datasets)
					.values({
						exchange: args.exchange,
						pairs: args.pairs,
						timeframe: args.timeframe,
						dateRange: args.dateRange,
						path: args.path,
					})
					.returning();
				if (!inserted) {
					return {
						isError: true,
						content: [{ type: "text", text: "register_dataset: insert returned no row" }],
					};
				}
				await db.insert(deskDatasets).values({
					deskId: ctx.deskId,
					datasetId: inserted.id,
				});
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({ datasetId: inserted.id, linked: true }, null, 2),
						},
					],
				};
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					isError: true,
					content: [{ type: "text", text: `register_dataset failed: ${msg}` }],
				};
			}
		},
	);

	return server;
}
