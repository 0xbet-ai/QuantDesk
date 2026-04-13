/**
 * esbuild configuration for building the quantdesk CLI for npm.
 *
 * The CLI runs in two modes:
 *   - **Standalone (npx):** bootstraps a fresh clone + install, then delegates
 *     to the local monorepo's `pnpm onboard`. No heavy dependencies needed.
 *   - **Monorepo (pnpm onboard):** dynamically imports workspace packages
 *     (@quantdesk/engines) for Docker image pulling, DB migration, etc.
 *
 * Workspace packages are marked external — they resolve via pnpm workspace
 * linking at dev time but are never included in the npm tarball.
 */

import esbuild from "esbuild";

await esbuild.build({
	entryPoints: ["src/index.ts"],
	bundle: true,
	platform: "node",
	target: "node20",
	format: "esm",
	outfile: "dist/index.js",
	banner: { js: "#!/usr/bin/env node" },
	external: ["@quantdesk/*"],
	treeShaking: true,
	sourcemap: true,
});
