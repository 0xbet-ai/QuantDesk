import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "./client.js";
import { strategyCatalog } from "./schema.js";

interface StrategyEntry {
	id: string;
	name: string;
	category: string;
	difficulty: string;
	description: string;
	summary?: string;
	indicators: string[];
	default_params: Record<string, unknown>;
	timeframes: string[];
	engine: string;
	source?: string;
}

const strategiesDir = resolve(import.meta.dirname, "../../../strategies");
const files = ["freqtrade.json", "nautilus.json"];

async function seed() {
	console.log("Seeding strategy catalog...");

	for (const file of files) {
		const path = resolve(strategiesDir, file);
		const entries: StrategyEntry[] = JSON.parse(readFileSync(path, "utf-8"));

		for (const entry of entries) {
			await db
				.insert(strategyCatalog)
				.values({
					id: entry.id,
					name: entry.name,
					category: entry.category,
					difficulty: entry.difficulty,
					description: entry.description,
					summary: entry.summary ?? null,
					indicators: entry.indicators,
					defaultParams: entry.default_params,
					timeframes: entry.timeframes,
					engine: entry.engine,
					source: entry.source ?? null,
				})
				.onConflictDoUpdate({
					target: strategyCatalog.id,
					set: {
						name: entry.name,
						category: entry.category,
						description: entry.description,
						summary: entry.summary ?? null,
						indicators: entry.indicators,
						defaultParams: entry.default_params,
						timeframes: entry.timeframes,
						engine: entry.engine,
						source: entry.source ?? null,
					},
				});
		}

		console.log(`  ${file}: ${entries.length} strategies`);
	}

	console.log("Seed complete.");
	process.exit(0);
}

seed().catch((err) => {
	console.error("Seed failed:", err);
	process.exit(1);
});
