/**
 * DB seed entry point.
 *
 * Currently a no-op: the only thing this script used to do was mirror
 * the strategy catalog JSON files into a `strategy_catalog` Postgres
 * table, and that mirror has been removed in favor of the server
 * reading the JSON files directly (see `server/src/services/strategies.ts`).
 *
 * Kept as an empty placeholder so `pnpm db:reset` continues to work
 * without having to edit the root `package.json` scripts — and so
 * there's an obvious place to add future seed data if/when some piece
 * of reference data actually needs to live in the DB.
 */

console.log("Seed: nothing to do (strategy catalog now reads straight from JSON).");
process.exit(0);
