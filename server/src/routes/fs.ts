/**
 * Read-only filesystem browser for the wizard's folder picker.
 *
 * This is a *localhost dev-tool* affordance — the server has full host fs
 * access, so the only protection that matters is the same deny-list the
 * `validateSeedPath` / `validateExternalMounts` validators use. The user
 * cannot pick `~/.ssh` etc. via the picker because the deny-list filters
 * those entries out of every listing.
 *
 * Listings only include directories by default; pass `?includeFiles=true`
 * to include regular files (used when picking an external dataset file to
 * bind-mount). Each entry carries a `kind` discriminator.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import {
	SEED_COPY_SKIP_NAMES,
	SEED_PATH_ABSOLUTE_DENY,
	SEED_PATH_HOME_DENY,
} from "@quantdesk/shared";
import { Router } from "express";
import { HttpError } from "../middleware/error.js";

const router = Router();

interface BrowseEntry {
	name: string;
	path: string;
	kind: "dir" | "file";
}

interface BrowseResponse {
	path: string;
	parent: string | null;
	entries: BrowseEntry[];
}

/**
 * Returns true if `absPath` is one of the user-secret directories the
 * deny-list rejects. We hide these from the listing entirely so the user
 * cannot even see them, never mind try to pick them.
 */
function isDeniedPath(absPath: string): boolean {
	for (const denied of SEED_PATH_ABSOLUTE_DENY) {
		if (absPath === denied || absPath.startsWith(`${denied}${sep}`)) return true;
	}
	const home = homedir();
	if (absPath.startsWith(`${home}${sep}`) || absPath === home) {
		const homeRel = absPath === home ? "" : absPath.slice(home.length + 1);
		for (const denied of SEED_PATH_HOME_DENY) {
			if (homeRel === denied || homeRel.startsWith(`${denied}${sep}`)) return true;
		}
	}
	return false;
}

router.get("/browse", (req, res, next) => {
	try {
		const requested = (req.query.path as string | undefined) ?? homedir();
		const includeFiles = req.query.includeFiles === "true";
		if (!isAbsolute(requested)) {
			throw new HttpError(400, "path must be absolute");
		}
		const absPath = resolve(requested);
		if (!existsSync(absPath)) {
			throw new HttpError(404, `path does not exist: ${absPath}`);
		}
		const stat = statSync(absPath);
		if (!stat.isDirectory()) {
			throw new HttpError(400, "path must be a directory");
		}
		if (isDeniedPath(absPath)) {
			throw new HttpError(403, "path is in the deny-list");
		}

		const entries: BrowseEntry[] = [];
		for (const name of readdirSync(absPath).sort()) {
			if (name.startsWith(".")) continue; // hidden
			if (SEED_COPY_SKIP_NAMES.includes(name)) continue;
			const childPath = join(absPath, name);
			let childStat: ReturnType<typeof statSync>;
			try {
				childStat = statSync(childPath);
			} catch {
				continue; // unreadable — skip
			}
			if (isDeniedPath(childPath)) continue;
			if (childStat.isDirectory()) {
				entries.push({ name, path: childPath, kind: "dir" });
			} else if (includeFiles && childStat.isFile()) {
				entries.push({ name, path: childPath, kind: "file" });
			}
		}

		const parent = absPath === "/" ? null : dirname(absPath);
		const body: BrowseResponse = { path: absPath, parent, entries };
		res.json(body);
	} catch (err) {
		next(err);
	}
});

export default router;
