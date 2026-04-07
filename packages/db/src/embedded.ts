import { createWriteStream, existsSync, mkdirSync, rmSync, type WriteStream } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";

/**
 * Launches (and caches) an embedded PostgreSQL instance for local development.
 *
 * QuantDesk runs Postgres in-process by default. Docker is reserved for the
 * engine executor layer (freqtrade / nautilus containers) — not for Postgres.
 *
 * Precedence:
 * 1. If `DATABASE_URL` is set, caller should use that and skip this module.
 * 2. Otherwise, call {@link getEmbeddedConnectionString} which will start a
 *    local Postgres cluster under `~/.quantdesk/pgdata` and return a
 *    `postgresql://…` URL pointing at it.
 */

const USER = "quantdesk";
const PASSWORD = "quantdesk";
const DATABASE = "quantdesk";

function defaultDataDir(): string {
	return process.env.QUANTDESK_PG_DATA_DIR ?? resolve(homedir(), ".quantdesk", "pgdata");
}

function defaultLogFile(): string {
	return process.env.QUANTDESK_PG_LOG_FILE ?? resolve(homedir(), ".quantdesk", "pg.log");
}

function defaultPort(): number {
	const raw = process.env.QUANTDESK_PG_PORT;
	if (raw) {
		const n = Number.parseInt(raw, 10);
		if (Number.isFinite(n) && n > 0) return n;
	}
	return 54329;
}

let started: Promise<string> | null = null;
let instance: EmbeddedPostgres | null = null;
let logStream: WriteStream | null = null;

function writeLog(prefix: string, message: unknown): void {
	if (!logStream) return;
	const text =
		message instanceof Error
			? `${message.stack ?? message.message}`
			: typeof message === "string"
				? message
				: JSON.stringify(message);
	const line = text.endsWith("\n") ? text : `${text}\n`;
	logStream.write(prefix ? `${prefix} ${line}` : line);
}

export async function getEmbeddedConnectionString(): Promise<string> {
	if (!started) {
		started = startEmbedded();
	}
	return started;
}

async function startEmbedded(): Promise<string> {
	const dataDir = defaultDataDir();
	const port = defaultPort();
	const logFile = defaultLogFile();

	mkdirSync(dataDir, { recursive: true });
	mkdirSync(resolve(logFile, ".."), { recursive: true });

	if (!logStream) {
		logStream = createWriteStream(logFile, { flags: "a" });
		logStream.write(`\n=== embedded postgres session ${new Date().toISOString()} ===\n`);
	}

	// Only remove a stale postmaster.pid if the referenced PID is not actually
	// alive. Blindly deleting it causes shmem conflicts when two processes race
	// to start the same cluster.
	const pidFile = resolve(dataDir, "postmaster.pid");
	if (existsSync(pidFile)) {
		try {
			const { readFileSync } = await import("node:fs");
			const pidRaw = readFileSync(pidFile, "utf-8").split("\n")[0]?.trim();
			const pid = pidRaw ? Number.parseInt(pidRaw, 10) : Number.NaN;
			if (Number.isFinite(pid) && pid > 0) {
				try {
					process.kill(pid, 0); // throws if the process doesn't exist
					// still alive — don't touch the pid file
				} catch {
					rmSync(pidFile, { force: true });
				}
			}
		} catch {
			// ignore — start() will surface a clearer error if anything's broken
		}
	}

	const pg = new EmbeddedPostgres({
		databaseDir: dataDir,
		user: USER,
		password: PASSWORD,
		port,
		persistent: true,
		initdbFlags: ["--encoding=UTF8", "--locale=C", "--lc-messages=C"],
		onLog: (msg) => writeLog("", msg),
		onError: (msg) => writeLog("[ERR]", msg),
	});

	if (!existsSync(resolve(dataDir, "PG_VERSION"))) {
		await pg.initialise();
	}

	await pg.start();
	instance = pg;

	// Ensure the application database exists. Check first so we don't log a
	// noisy "already exists" error on every startup.
	const admin = postgres({
		host: "127.0.0.1",
		port,
		user: USER,
		password: PASSWORD,
		database: "postgres",
		max: 1,
	});
	try {
		const rows = await admin<{ exists: boolean }[]>`
			SELECT EXISTS (
				SELECT 1 FROM pg_database WHERE datname = ${DATABASE}
			) AS exists
		`;
		if (!rows[0]?.exists) {
			await pg.createDatabase(DATABASE);
		}
	} finally {
		await admin.end({ timeout: 5 });
	}

	const register = () => {
		void stopEmbedded();
	};
	process.once("exit", register);
	process.once("SIGINT", () => {
		register();
		process.exit(130);
	});
	process.once("SIGTERM", () => {
		register();
		process.exit(143);
	});

	console.log(
		`Embedded Postgres ready at 127.0.0.1:${port} (data: ${dataDir}, logs: ${logFile})`,
	);

	return `postgresql://${USER}:${PASSWORD}@127.0.0.1:${port}/${DATABASE}`;
}

export async function stopEmbedded(): Promise<void> {
	if (instance) {
		try {
			await instance.stop();
		} catch {
			// best effort on shutdown
		}
		instance = null;
		started = null;
	}
	if (logStream) {
		logStream.end();
		logStream = null;
	}
}

/**
 * Resolve the connection string, preferring `DATABASE_URL` and falling back
 * to the embedded Postgres. Callers that want to *force* embedded mode can
 * call {@link getEmbeddedConnectionString} directly.
 */
export async function resolveConnectionString(): Promise<string> {
	if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
	return getEmbeddedConnectionString();
}
