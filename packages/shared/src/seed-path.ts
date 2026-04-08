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
