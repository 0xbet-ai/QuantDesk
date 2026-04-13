#!/usr/bin/env node
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { ENGINE_IMAGES, ensureDockerAvailable, hasImage, pullImage } from "@quantdesk/engines";

const args = process.argv.slice(2);
const cmd = args.find((a) => !a.startsWith("-"));
const yes = args.includes("--yes") || args.includes("-y");
const run = args.includes("--run");

function repoRoot(): string {
	return resolve(import.meta.dirname, "..", "..");
}

/** Run a shell command, inheriting stdio so the user sees output. */
function sh(command: string, shellArgs: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, shellArgs, {
			stdio: "inherit",
			cwd: repoRoot(),
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code !== 0) reject(new Error(`${command} ${shellArgs.join(" ")} exited ${code}`));
			else resolve();
		});
	});
}

async function checkDocker(): Promise<void> {
	console.log("Checking Docker...");
	try {
		await ensureDockerAvailable();
	} catch (err) {
		console.error(
			"Docker is not available. Install Docker Desktop and make sure it is running, then retry.",
		);
		console.error(err instanceof Error ? err.message : err);
		process.exit(1);
	}
	console.log("Docker OK.");
	console.log("");
}

async function pullEngineImages(): Promise<void> {
	const images = Object.entries(ENGINE_IMAGES);
	console.log(
		`Pulling ${images.length} engine image(s). This can take several minutes on first run.`,
	);
	for (const [engine, image] of images) {
		process.stdout.write(`  - ${engine} (${image}) ... `);
		try {
			if (await hasImage(image)) {
				console.log("already present");
				continue;
			}
			await pullImage(image);
			console.log("done");
		} catch (err) {
			console.log("FAILED");
			console.error(err instanceof Error ? err.message : err);
			process.exit(1);
		}
	}
	console.log("");
}

async function runMigrations(): Promise<void> {
	console.log("Running database migrations...");
	try {
		await sh("pnpm", ["db:migrate"]);
	} catch {
		console.error("Database migration failed.");
		process.exit(1);
	}
	console.log("");
}

async function startDev(): Promise<void> {
	console.log("Starting QuantDesk...");
	console.log("");
	// Replace the current process with pnpm dev so Ctrl-C works naturally.
	const child = spawn("pnpm", ["dev"], {
		stdio: "inherit",
		cwd: repoRoot(),
	});
	child.on("close", (code) => process.exit(code ?? 0));
}

async function onboard() {
	console.log("QuantDesk onboard");
	if (yes) console.log("  --yes: using defaults, will start server after setup.");
	console.log("");

	await checkDocker();
	await pullEngineImages();
	await runMigrations();

	if (yes || run) {
		await startDev();
	} else {
		console.log("All set. Run `pnpm dev` to start QuantDesk.");
	}
}

switch (cmd) {
	case "onboard":
		await onboard();
		break;
	default:
		console.log("Usage: quantdesk <command>");
		console.log("");
		console.log("Commands:");
		console.log("  onboard              Check Docker, pull images, migrate DB");
		console.log("");
		console.log("Options:");
		console.log("  --yes, -y            Accept defaults and start dev server");
		console.log("  --run                Start dev server after setup");
		process.exit(cmd ? 1 : 0);
}
