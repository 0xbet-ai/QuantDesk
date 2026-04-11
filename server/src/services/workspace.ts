import { exec } from "node:child_process";
import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { getAdapter as getEngineAdapter } from "@quantdesk/engines";
import { SEED_COPY_SKIP_NAMES } from "@quantdesk/shared";
import { loadVenueGuides } from "./venue-guides.js";

const execAsync = promisify(exec);

async function git(cwd: string, ...args: string[]): Promise<string> {
	const { stdout } = await execAsync(`git ${args.join(" ")}`, { cwd });
	return stdout.trim();
}

export interface InitWorkspaceOptions {
	/**
	 * Optional absolute host path to a directory of strategy/config files
	 * to seed the workspace from instead of writing the engine's stock
	 * template. Validated upstream by `validateSeedPath` — by the time
	 * `initWorkspace` sees it, the path is trusted.
	 */
	seedCodePath?: string;
	/**
	 * Primary venue for the desk. Passed through to the engine adapter's
	 * `workspaceTemplate` so the seeded config references the user-chosen
	 * exchange instead of a hard-coded default.
	 */
	venue?: string;
	/**
	 * Full venue list for the desk. Used to seed per-venue fetch guides
	 * from `packages/venues/` into `<workspace>/.quantdesk/`.
	 * Falls back to `[venue]` when omitted.
	 */
	venues?: readonly string[];
}

export async function initWorkspace(
	deskId: string,
	engine: string,
	workspacesRoot: string,
	options: InitWorkspaceOptions = {},
): Promise<string> {
	const dir = join(workspacesRoot, deskId);
	await mkdir(dir, { recursive: true });

	await git(dir, "init");
	await git(dir, "config", "user.email", '"quantdesk@local"');
	await git(dir, "config", "user.name", '"QuantDesk"');

	if (options.seedCodePath) {
		await bootstrapWorkspace(dir, options.seedCodePath);
		await git(dir, "add", "-A");
		const seedName = basename(options.seedCodePath);
		await git(dir, "commit", "-m", `"chore: seed from ${seedName.replace(/"/g, '\\"')}"`);
	} else {
		// Delegate the template to the engine adapter — the server must
		// not hard-code per-engine file contents (CLAUDE.md rule #6).
		// Venue is required: adapters must not invent a default exchange
		// when one is missing, so fail loud here if the caller forgot.
		if (!options.venue) {
			throw new Error(
				"initWorkspace: `venue` is required when no seedCodePath is provided — the engine adapter needs it to stamp exchange fields into the seeded config.",
			);
		}
		const venue = options.venue;
		let template: Record<string, string>;
		try {
			template = getEngineAdapter(engine).workspaceTemplate({ venue });
		} catch (err) {
			// Unknown engine → fall back to the generic adapter's template.
			// A real adapter failure (e.g. missing venue) should propagate —
			// but `getEngineAdapter` throws only on unknown engine names, so
			// catching this here is narrow and intentional.
			if (err instanceof Error && err.message.includes("venue")) throw err;
			template = getEngineAdapter("generic").workspaceTemplate({ venue });
		}
		for (const [filename, content] of Object.entries(template)) {
			await writeFile(join(dir, filename), content);
		}
		await git(dir, "add", "-A");
		await git(dir, "commit", "-m", '"Initial workspace setup"');
	}

	// Seed per-venue fetch guides (optional reference catalog).
	// Missing guides are silently skipped; the agent falls back to the
	// generic data acquisition instructions in the tools-glossary block.
	const venueList = options.venues ?? (options.venue ? [options.venue] : []);
	const guides = loadVenueGuides(venueList);
	if (guides.length > 0) {
		const guideDir = join(dir, ".quantdesk");
		await mkdir(guideDir, { recursive: true });
		for (const guide of guides) {
			await writeFile(join(guideDir, guide.workspaceFilename), guide.content);
		}
		await git(dir, "add", "-A");
		await git(dir, "commit", "-m", '"chore: seed venue fetch guides"');
	}

	return dir;
}

/**
 * Recursively copy every regular file from `srcDir` into `destDir`,
 * preserving directory structure. Skips files / directories whose name is
 * in `SEED_COPY_SKIP_NAMES` (`.git`, `node_modules`, `__pycache__`, etc.).
 *
 * Idempotent: re-copying the same source onto the same destination is a
 * no-op (file contents are identical) — used by tests + recovery flows.
 */
export async function bootstrapWorkspace(destDir: string, srcDir: string): Promise<void> {
	await mkdir(destDir, { recursive: true });
	await copyTree(srcDir, destDir);
}

async function copyTree(src: string, dest: string): Promise<void> {
	const entries = await readdir(src);
	for (const entry of entries) {
		if (SEED_COPY_SKIP_NAMES.includes(entry)) continue;
		const srcPath = join(src, entry);
		const destPath = join(dest, entry);
		const st = await stat(srcPath);
		if (st.isDirectory()) {
			await mkdir(destPath, { recursive: true });
			await copyTree(srcPath, destPath);
		} else if (st.isFile()) {
			await copyFile(srcPath, destPath);
		}
	}
}

export async function commitCode(cwd: string, message: string): Promise<string> {
	await git(cwd, "add", "-A");
	// Build a short summary of changed files for the commit body
	const staged = await git(cwd, "diff", "--cached", "--name-only");
	const files = staged
		.split("\n")
		.map((f) => f.trim())
		.filter(Boolean);
	const body =
		files.length > 0
			? `\n\nChanged: ${files.slice(0, 5).join(", ")}${files.length > 5 ? ` (+${files.length - 5} more)` : ""}`
			: "";
	const full = `${message}${body}`.replace(/"/g, '\\"');
	await git(cwd, "commit", "-m", `"${full}"`);
	const hash = await git(cwd, "rev-parse", "HEAD");
	return hash;
}

export async function getCode(cwd: string, commitHash: string, filePath: string): Promise<string> {
	const { stdout } = await execAsync(`git show ${commitHash}:${filePath}`, { cwd });
	return stdout;
}

export async function getDiff(cwd: string, hash1: string, hash2: string): Promise<string> {
	return git(cwd, "diff", hash1, hash2);
}

export async function hasChanges(cwd: string): Promise<boolean> {
	const status = await git(cwd, "status", "--porcelain");
	return status.length > 0;
}

/**
 * Return the current HEAD commit hash for the workspace. Used to stamp
 * runs.commit_hash with the exact code + config that produced a backtest,
 * so a user can reproduce any historical run by checking out the hash.
 */
export async function getHead(cwd: string): Promise<string> {
	return git(cwd, "rev-parse", "HEAD");
}

/**
 * Ensure the workspace has a commit for the current state and return its
 * hash. If the tree is dirty, commit with `message`; otherwise return the
 * existing HEAD. Idempotent — safe to call before every backtest so that
 * `runs.commit_hash` always points at the exact inputs that produced a
 * run, even when the agent runs many backtests in one turn.
 */
export async function ensureCommit(cwd: string, message: string): Promise<string> {
	if (await hasChanges(cwd)) {
		return commitCode(cwd, message);
	}
	return getHead(cwd);
}

export interface CommitInfo {
	hash: string;
	message: string;
	date: string;
}

export async function getLog(cwd: string, limit = 50): Promise<CommitInfo[]> {
	const raw = await git(cwd, "log", `--max-count=${limit}`, "--format=%H%n%s%n%aI%n---");
	if (!raw) return [];
	const commits: CommitInfo[] = [];
	const entries = raw.split("---").filter((s) => s.trim());
	for (const entry of entries) {
		const lines = entry.trim().split("\n");
		if (lines.length >= 3) {
			commits.push({ hash: lines[0]!, message: lines[1]!, date: lines[2]! });
		}
	}
	return commits;
}

export async function listFiles(cwd: string, commitHash?: string): Promise<string[]> {
	const ref = commitHash ?? "HEAD";
	const raw = await git(cwd, "ls-tree", "-r", "--name-only", ref);
	if (!raw) return [];
	return raw.split("\n").filter((s) => s.trim());
}
