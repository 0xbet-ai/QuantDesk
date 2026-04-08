/**
 * Phase 09 — server-side seed path validation. Pure-ish: takes an absolute
 * path and walks the filesystem to verify it. The deny lists themselves
 * live in `@quantdesk/shared` so any future CLI/UI prevalidator can reuse
 * them.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { DeskExternalMount } from "@quantdesk/db/schema";
import {
	EXTERNAL_MOUNT_LABEL_PATTERN,
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

/**
 * Phase 10 — validate one external bind-mount before persisting it on a
 * desk. Reuses {@link validateSeedPath} for the path-deny logic; adds the
 * label-format check on top so the label is safe to inject into a Docker
 * `-v` arg later.
 */
export type ExternalMountValidation =
	| { ok: true; mount: DeskExternalMount }
	| { ok: false; reason: string };

export function validateExternalMount(mount: {
	label: string;
	hostPath: string;
	description?: string;
}): ExternalMountValidation {
	if (!mount.label || typeof mount.label !== "string") {
		return { ok: false, reason: "external mount label is required" };
	}
	if (!EXTERNAL_MOUNT_LABEL_PATTERN.test(mount.label)) {
		return {
			ok: false,
			reason: `external mount label "${mount.label}" must match ${EXTERNAL_MOUNT_LABEL_PATTERN.source}`,
		};
	}
	const pathCheck = validateSeedPath(mount.hostPath);
	if (!pathCheck.ok) {
		return { ok: false, reason: `external mount "${mount.label}": ${pathCheck.reason}` };
	}
	return {
		ok: true,
		mount: {
			label: mount.label,
			hostPath: pathCheck.absolutePath,
			description: mount.description,
		},
	};
}

/**
 * Validate every mount in a list and reject duplicate labels within the
 * same desk. Returns a normalized list (each `hostPath` resolved) on success.
 */
export function validateExternalMounts(
	mounts: Array<{ label: string; hostPath: string; description?: string }>,
): { ok: true; mounts: DeskExternalMount[] } | { ok: false; reason: string } {
	const out: DeskExternalMount[] = [];
	const seen = new Set<string>();
	for (const m of mounts) {
		const result = validateExternalMount(m);
		if (!result.ok) return { ok: false, reason: result.reason };
		if (seen.has(result.mount.label)) {
			return {
				ok: false,
				reason: `external mount label "${result.mount.label}" is used twice in the same desk`,
			};
		}
		seen.add(result.mount.label);
		out.push(result.mount);
	}
	return { ok: true, mounts: out };
}
