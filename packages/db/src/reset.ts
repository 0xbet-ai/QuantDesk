import { createInterface } from "node:readline";
import { sql } from "drizzle-orm";
import { db, initDb } from "./client.js";

await initDb();

async function confirm(message: string): Promise<boolean> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		rl.question(`${message} (y/N) `, (answer) => {
			rl.close();
			resolve(answer.trim().toLowerCase() === "y");
		});
	});
}

async function reset() {
	console.log("\x1b[31m⚠ This will DROP all tables and data.\x1b[0m");
	const ok = await confirm("Are you sure?");
	if (!ok) {
		console.log("Aborted.");
		process.exit(0);
	}

	console.log("Dropping all schemas...");
	await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
	await db.execute(sql`DROP SCHEMA public CASCADE`);
	await db.execute(sql`CREATE SCHEMA public`);
	console.log("Done.");
	process.exit(0);
}

reset().catch((err) => {
	console.error("Reset failed:", err);
	process.exit(1);
});
