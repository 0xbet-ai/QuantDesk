import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { db } from "@quantdesk/db";
import { datasets, desks, experiments } from "@quantdesk/db/schema";
import { ENGINE_IMAGES, runContainer } from "@quantdesk/engines";
import { eq } from "drizzle-orm";
import { createComment } from "./comments.js";
import type { DataFetchProposal } from "./triggers.js";

interface ExecuteArgs {
	experimentId: string;
	proposal: DataFetchProposal;
}

/**
 * Execute an approved data-fetch proposal. Engine-aware:
 *  - classic → runs `freqtrade download-data` in a container
 *  - realtime / generic → stubbed (agent fetches via its own tools)
 *
 * Posts a system comment summarising the outcome and returns the created
 * dataset row (if any).
 */
export async function executeDataFetch({ experimentId, proposal }: ExecuteArgs) {
	const [experiment] = await db
		.select()
		.from(experiments)
		.where(eq(experiments.id, experimentId));
	if (!experiment) throw new Error(`Experiment ${experimentId} not found`);

	const [desk] = await db.select().from(desks).where(eq(desks.id, experiment.deskId));
	if (!desk) throw new Error(`Desk ${experiment.deskId} not found`);

	if (!desk.workspacePath) {
		throw new Error(`Desk ${desk.id} has no workspace path`);
	}

	if (desk.strategyMode !== "classic") {
		// realtime / generic: we don't run a download container — the agent
		// is responsible. Just log a system comment so the conversation
		// moves forward.
		await createComment({
			experimentId,
			author: "system",
			content:
				`Data-fetch proposal approved, but strategy_mode=${desk.strategyMode} does not have a ` +
				"server-side fetcher. Proceed to fetch the data yourself from within your strategy workspace.",
		});
		return null;
	}

	// Classic: freqtrade download-data
	const workspaceAbs = resolve(desk.workspacePath);
	const end = new Date();
	const start = new Date(end.getTime() - proposal.days * 24 * 60 * 60 * 1000);
	const fmt = (d: Date) =>
		`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
	const timerange = `${fmt(start)}-${fmt(end)}`;

	await createComment({
		experimentId,
		author: "system",
		content:
			`Downloading ${proposal.pairs.join(", ")} ${proposal.timeframe} from ${proposal.exchange} ` +
			`(${proposal.days}d, ${timerange})...`,
	});

	const cmd = [
		"download-data",
		"--userdir",
		"/freqtrade/user_data",
		"--exchange",
		proposal.exchange,
		"--pairs",
		...proposal.pairs,
		"--timeframes",
		proposal.timeframe,
		"--timerange",
		timerange,
	];
	if (proposal.tradingMode && proposal.tradingMode !== "spot") {
		cmd.push("--trading-mode", proposal.tradingMode);
	}

	const result = await runContainer({
		image: ENGINE_IMAGES.freqtrade,
		rm: true,
		volumes: [`${workspaceAbs}:/freqtrade/user_data`],
		command: cmd,
	});

	const dataDir = join(workspaceAbs, "data", proposal.exchange);
	const files =
		existsSync(dataDir) && readdirSync(dataDir).filter((f) => !f.startsWith("."));
	const fileCount = files ? files.length : 0;

	if (result.exitCode !== 0 || fileCount === 0) {
		const tail = (result.stderr || result.stdout || "")
			.trimEnd()
			.split("\n")
			.slice(-8)
			.join("\n");
		await createComment({
			experimentId,
			author: "system",
			content:
				`Data-fetch failed for ${proposal.pairs.join(", ")} on ${proposal.exchange}. ` +
				"Check the pair naming and trade mode, then emit a corrected [PROPOSE_DATA_FETCH]. " +
				`Last log lines:\n\`\`\`\n${tail || "(no output)"}\n\`\`\``,
		});
		return null;
	}

	const [dataset] = await db
		.insert(datasets)
		.values({
			deskId: desk.id,
			exchange: proposal.exchange,
			pairs: proposal.pairs,
			timeframe: proposal.timeframe,
			dateRange: {
				start: start.toISOString().slice(0, 10),
				end: end.toISOString().slice(0, 10),
			},
			path: dataDir,
		})
		.returning();

	await createComment({
		experimentId,
		author: "system",
		content:
			`Downloaded ${fileCount} file(s) for ${proposal.pairs.join(", ")} ` +
			`${proposal.timeframe} from ${proposal.exchange}. Dataset registered. ` +
			"You may now write the strategy and emit [RUN_BACKTEST].",
	});

	return dataset ?? null;
}
