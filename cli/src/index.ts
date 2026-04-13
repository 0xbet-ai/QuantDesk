import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_URL = "https://github.com/0xbet-ai/QuantDesk.git";

const args = process.argv.slice(2);
const cmd = args.find((a) => !a.startsWith("-"));
const yes = args.includes("--yes") || args.includes("-y");
const run = args.includes("--run");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sh(command: string, shellArgs: string[], cwd?: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, shellArgs, { stdio: "inherit", cwd });
		child.on("error", reject);
		child.on("close", (code) => {
			if (code !== 0) reject(new Error(`${command} ${shellArgs.join(" ")} exited ${code}`));
			else resolve();
		});
	});
}

function repoRoot(): string {
	return resolve(import.meta.dirname, "..", "..");
}

/**
 * Detect whether we're running inside the QuantDesk monorepo (via `pnpm
 * onboard`) or standalone (via `npx quantdesk`). When esbuild bundles the
 * CLI for npm, workspace packages are external and won't resolve — the
 * dynamic import in `localOnboard()` will throw and we fall back to
 * bootstrap mode.
 */
function isInMonorepo(): boolean {
	try {
		return existsSync(join(repoRoot(), "packages", "engines", "package.json"));
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// Bootstrap mode — runs from `npx quantdesk`, no monorepo present
// ---------------------------------------------------------------------------

async function bootstrap(): Promise<void> {
	const targetDir = resolve(process.cwd(), "QuantDesk");

	console.log("QuantDesk setup");
	console.log("");

	// Prerequisites
	for (const bin of ["git", "pnpm", "docker"]) {
		try {
			const { execSync } = await import("node:child_process");
			execSync(`${bin} --version`, { stdio: "ignore" });
		} catch {
			console.error(`${bin} is required but not found. Please install it first.`);
			process.exit(1);
		}
	}

	// Clone
	if (existsSync(targetDir)) {
		console.log(`${targetDir} already exists, skipping clone.`);
	} else {
		console.log("Cloning QuantDesk...");
		await sh("git", ["clone", REPO_URL, targetDir]);
	}
	console.log("");

	// Install
	console.log("Installing dependencies...");
	await sh("pnpm", ["install"], targetDir);
	console.log("");

	// Delegate to local onboard
	const localArgs = ["onboard"];
	if (yes) localArgs.push("--yes");
	else if (run) localArgs.push("--run");
	await sh("pnpm", localArgs, targetDir);
}

// ---------------------------------------------------------------------------
// Local mode — runs inside monorepo via `pnpm onboard`
// ---------------------------------------------------------------------------

async function localOnboard(): Promise<void> {
	const { ENGINE_IMAGES, ensureDockerAvailable, hasImage, pullImage } = await import(
		"@quantdesk/engines"
	);

	// Docker check
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

	// Pull images
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

	// Migrate
	console.log("Running database migrations...");
	try {
		await sh("pnpm", ["db:migrate"], repoRoot());
	} catch {
		console.error("Database migration failed.");
		process.exit(1);
	}
	console.log("");

	// Start dev server
	if (yes || run) {
		console.log("Starting QuantDesk...");
		console.log("");
		const child = spawn("pnpm", ["dev"], { stdio: "inherit", cwd: repoRoot() });
		child.on("close", (code) => process.exit(code ?? 0));
	} else {
		console.log("All set. Run `pnpm dev` to start QuantDesk.");
	}
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

async function onboard(): Promise<void> {
	console.log("QuantDesk onboard");
	if (yes) console.log("  --yes: using defaults, will start server after setup.");
	console.log("");

	if (isInMonorepo()) {
		await localOnboard();
	} else {
		await bootstrap();
	}
}

switch (cmd) {
	case "onboard":
		await onboard();
		break;
	default:
		console.log("Usage: quantdesk onboard [options]");
		console.log("");
		console.log("Options:");
		console.log("  --yes, -y   Accept defaults and start dev server");
		console.log("  --run       Start dev server after setup");
		console.log("");
		console.log("Run from anywhere:");
		console.log("  npx quantdesk onboard --yes");
		console.log("");
		console.log("Run from monorepo:");
		console.log("  pnpm onboard --yes");
		process.exit(cmd ? 1 : 0);
}
