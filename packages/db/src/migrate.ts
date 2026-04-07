import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { initDb } from "./client.js";

async function main() {
	const db = await initDb();
	const migrationsFolder = resolve(import.meta.dirname, "..", "drizzle");
	console.log(`Applying migrations from ${migrationsFolder}...`);
	await migrate(db, { migrationsFolder });
	console.log("Migrations applied.");
	process.exit(0);
}

main().catch((err) => {
	console.error("Migration failed:", err);
	process.exit(1);
});
