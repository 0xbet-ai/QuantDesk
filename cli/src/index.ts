#!/usr/bin/env node
import {
	ENGINE_IMAGES,
	ensureDockerAvailable,
	hasImage,
	pullImage,
} from "@quantdesk/engines";

const [, , cmd] = process.argv;

async function onboard() {
	console.log("QuantDesk onboard");
	console.log("");
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

	const images = Object.entries(ENGINE_IMAGES);
	console.log(`Pulling ${images.length} engine image(s). This can take several minutes on first run.`);
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
	console.log("All engine images ready. You can now run `pnpm dev`.");
}

switch (cmd) {
	case "onboard":
		await onboard();
		break;
	default:
		console.log("Usage: quantdesk <command>");
		console.log("");
		console.log("Commands:");
		console.log("  onboard    Check Docker and pre-pull engine images");
		process.exit(cmd ? 1 : 0);
}
