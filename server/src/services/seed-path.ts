/**
 * Phase 09 — server-side seed path validation. Pure-ish: takes an absolute
 * path and walks the filesystem to verify it. The deny lists themselves
 * live in `@quantdesk/shared` so any future CLI/UI prevalidator can reuse
 * them.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
	SEED_COPY_SKIP_NAMES,
	SEED_PATH_ABSOLUTE_DENY,
	SEED_PATH_HOME_DENY,
	SEED_PATH_MAX_BYTES,
} from "@quantdesk/shared";

export type SeedPathValidation =
	| { ok: true; absolutePath: string; totalBytes: number }
	| { ok: false; reason: string };

/**
 * Validate a host path before bootstrapping a desk workspace from it.
 *
 * Rejects:
 *   - non-absolute paths
 *   - non-existent / unreadable paths
 *   - the user's home root itself
 *   - paths inside well-known secret-bearing directories
 *   - paths anchored under `/etc`, `/root`, etc.
 *   - directories whose total file size exceeds `SEED_PATH_MAX_BYTES`
 */
export function validateSeedPath(rawPath: string): SeedPathValidation {
	if (!rawPath || typeof rawPath !== "string") {
		return { ok: false, reason: "seed path is required" };
	}
	if (!isAbsolute(rawPath)) {
		return { ok: false, reason: "seed path must be absolute" };
	}
	const absolutePath = resolve(rawPath);

	const home = homedir();
	if (absolutePath === home) {
		return { ok: false, reason: "seed path cannot be the user home directory itself" };
	}

	for (const denied of SEED_PATH_ABSOLUTE_DENY) {
		if (absolutePath === denied || absolutePath.startsWith(`${denied}/`)) {
			return { ok: false, reason: `seed path is inside the denied prefix ${denied}` };
		}
	}

	const homeRel = relative(home, absolutePath);
	const isInHome = !homeRel.startsWith("..") && !isAbsolute(homeRel);
	if (isInHome) {
		for (const denied of SEED_PATH_HOME_DENY) {
			if (homeRel === denied || homeRel.startsWith(`${denied}/`)) {
				return {
					ok: false,
					reason: `seed path is inside the denied home prefix ~/${denied}`,
				};
			}
		}
	}

	if (!existsSync(absolutePath)) {
		return { ok: false, reason: "seed path does not exist" };
	}
	let stat: ReturnType<typeof statSync>;
	try {
		stat = statSync(absolutePath);
	} catch (err) {
		return { ok: false, reason: `seed path is not readable: ${(err as Error).message}` };
	}
	if (!stat.isDirectory()) {
		return { ok: false, reason: "seed path must be a directory" };
	}

	let totalBytes = 0;
	try {
		totalBytes = computeDirSize(absolutePath);
	} catch (err) {
		return { ok: false, reason: `seed path scan failed: ${(err as Error).message}` };
	}
	if (totalBytes > SEED_PATH_MAX_BYTES) {
		return {
			ok: false,
			reason: `seed path is ${(totalBytes / 1024 / 1024).toFixed(1)} MB, exceeds the ${SEED_PATH_MAX_BYTES / 1024 / 1024} MB cap`,
		};
	}

	return { ok: true, absolutePath, totalBytes };
}

function computeDirSize(dir: string): number {
	let total = 0;
	const entries = readdirSync(dir);
	for (const entry of entries) {
		if (SEED_COPY_SKIP_NAMES.includes(entry)) continue;
		const full = join(dir, entry);
		const st = statSync(full);
		if (st.isDirectory()) {
			total += computeDirSize(full);
		} else if (st.isFile()) {
			total += st.size;
		}
	}
	return total;
}
