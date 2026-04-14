/**
 * Phase 09 — workspace bootstrap deny lists.
 *
 * Constants only — the actual filesystem-touching `validateSeedPath` lives
 * in `server/src/services/seed-path.ts` because `packages/shared` is
 * fs-free. Both the server and any future CLI/UI validator can import these
 * constants.
 *
 * The deny list is conservative: anything matching one of these is rejected
 * outright. The intent is to prevent the user from accidentally seeding a
 * desk from a directory full of secrets, system config, or huge build
 * artefacts.
 */

/**
 * Absolute path prefixes that are always rejected. Kept narrow on purpose
 * — adding `/var` or `/usr` breaks `mkdtemp(tmpdir())` on macOS, which
 * resolves under `/var/folders/...`. The home-prefix list (below) handles
 * the more dangerous user-secret directories.
 */
export const SEED_PATH_ABSOLUTE_DENY: readonly string[] = ["/etc", "/root"];

/** Path segments under the user's home directory that are always rejected. */
export const SEED_PATH_HOME_DENY: readonly string[] = [
	".ssh",
	".aws",
	".gnupg",
	".gpg",
	".config/gh",
	".kube",
	".docker",
	".npmrc",
	".pypirc",
];

/** Maximum cumulative size of files under a seed directory (50 MB). */
export const SEED_PATH_MAX_BYTES = 50 * 1024 * 1024;

/** File / directory names skipped during the recursive copy. */
export const SEED_COPY_SKIP_NAMES: readonly string[] = [
	".git",
	"node_modules",
	"__pycache__",
	".venv",
	"venv",
	".pytest_cache",
	".mypy_cache",
	"dist",
	"build",
	".DS_Store",
];

/**
 * Phase 10 — external dataset bind-mount label format. Becomes a path
 * segment under `/workspace/data/external/<label>` so it must be safe for
 * filesystems and shells alike: lowercase letters, digits, underscore,
 * hyphen, dot. The leading `[a-z0-9]` anchor prevents hidden-file / parent-
 * segment injection (`.`, `..`, `.ssh`, …).
 */
export const EXTERNAL_MOUNT_LABEL_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/**
 * Derive a valid external-mount label from a file or directory basename.
 * Lowercases, replaces any character not in the label pattern with `_`,
 * strips a leading non-`[a-z0-9]` run, and trims to 64 chars. Returns
 * `null` when the result is empty (e.g. basename was all separators).
 */
export function deriveExternalMountLabel(basename: string): string | null {
	const sanitized = basename
		.toLowerCase()
		.replace(/[^a-z0-9._-]/g, "_")
		.replace(/^[^a-z0-9]+/, "")
		.slice(0, 64);
	return sanitized.length > 0 ? sanitized : null;
}
