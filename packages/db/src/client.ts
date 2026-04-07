import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { resolveConnectionString } from "./embedded.js";
import * as schema from "./schema.js";

/**
 * Database client.
 *
 * Startup flow:
 *   1. Call `await initDb()` at the very start of every entry point
 *      (server index, CLI, migrate/seed/reset scripts, tests).
 *   2. Once initialised, import `{ db }` and use Drizzle normally.
 *
 * Behind the scenes `initDb()` resolves a connection string — either the
 * external `DATABASE_URL` or an in-process embedded Postgres cluster under
 * `~/.quantdesk/pgdata`.
 */

type Postgres = ReturnType<typeof postgres>;
type Drizzle = ReturnType<typeof drizzle<typeof schema>>;

let sqlClient: Postgres | null = null;
let drizzleClient: Drizzle | null = null;

export async function initDb(): Promise<Drizzle> {
	if (drizzleClient) return drizzleClient;
	const connectionString = await resolveConnectionString();
	sqlClient = postgres(connectionString);
	drizzleClient = drizzle(sqlClient, { schema });
	return drizzleClient;
}

export async function closeDb(): Promise<void> {
	if (sqlClient) {
		await sqlClient.end({ timeout: 5 });
		sqlClient = null;
		drizzleClient = null;
	}
}

/**
 * Module-level proxy that forwards to the initialised client. Accessing `db`
 * before `initDb()` has run throws — this catches ordering bugs early instead
 * of producing opaque errors from inside Drizzle.
 */
export const db = new Proxy({} as Drizzle, {
	get(_target, prop) {
		if (!drizzleClient) {
			throw new Error(
				`Database not initialised — call \`await initDb()\` before using the db client. Attempted to access db.${String(prop)}.`,
			);
		}
		// biome-ignore lint/suspicious/noExplicitAny: proxy forwarding
		return (drizzleClient as any)[prop];
	},
});
