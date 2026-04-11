import { describe, expect, it } from "vitest";
import { buildRunArgs, parseLabelString, quantdeskLabels } from "../docker.js";
import { ENGINE_IMAGES, getEngineImage } from "../images.js";

describe("buildRunArgs", () => {
	it("minimal args", () => {
		const args = buildRunArgs({ image: "alpine:3.19" });
		expect(args).toEqual(["run", "alpine:3.19"]);
	});

	it("ephemeral run with --rm", () => {
		const args = buildRunArgs({ image: "alpine:3.19", rm: true, command: ["echo", "hi"] });
		expect(args).toEqual(["run", "--rm", "alpine:3.19", "echo", "hi"]);
	});

	it("detached", () => {
		const args = buildRunArgs({ image: "alpine:3.19", detach: true });
		expect(args).toEqual(["run", "-d", "alpine:3.19"]);
	});

	it("name + workdir + network", () => {
		const args = buildRunArgs({
			image: "alpine:3.19",
			name: "quantdesk-paper-abc",
			workdir: "/workspace",
			network: "bridge",
		});
		expect(args).toEqual([
			"run",
			"--name",
			"quantdesk-paper-abc",
			"--workdir",
			"/workspace",
			"--network",
			"bridge",
			"alpine:3.19",
		]);
	});

	it("resource limits", () => {
		const args = buildRunArgs({
			image: "alpine:3.19",
			cpus: "2",
			memory: "2g",
			pidsLimit: 512,
		});
		expect(args).toContain("--cpus=2");
		expect(args).toContain("--memory=2g");
		expect(args).toContain("--pids-limit=512");
	});

	it("labels are emitted in key=value form", () => {
		const args = buildRunArgs({
			image: "freqtradeorg/freqtrade:stable_2025.7",
			labels: {
				"quantdesk.runId": "run-123",
				"quantdesk.engine": "freqtrade",
				"quantdesk.kind": "paper",
			},
		});
		expect(args).toContain("--label");
		expect(args).toContain("quantdesk.runId=run-123");
		expect(args).toContain("quantdesk.engine=freqtrade");
		expect(args).toContain("quantdesk.kind=paper");
	});

	it("volume bind mounts", () => {
		const args = buildRunArgs({
			image: "alpine:3.19",
			volumes: ["/host/workspace:/workspace", "/host/data:/data:ro"],
		});
		const vIdxs = args.map((a, i) => (a === "-v" ? i : -1)).filter((i) => i !== -1);
		expect(vIdxs).toHaveLength(2);
		expect(args[vIdxs[0]! + 1]).toBe("/host/workspace:/workspace");
		expect(args[vIdxs[1]! + 1]).toBe("/host/data:/data:ro");
	});

	it("port mappings", () => {
		const args = buildRunArgs({
			image: "alpine:3.19",
			ports: ["8080:8080", "127.0.0.1:9090:9090"],
		});
		const pIdxs = args.map((a, i) => (a === "-p" ? i : -1)).filter((i) => i !== -1);
		expect(pIdxs).toHaveLength(2);
		expect(args[pIdxs[0]! + 1]).toBe("8080:8080");
		expect(args[pIdxs[1]! + 1]).toBe("127.0.0.1:9090:9090");
	});

	it("env vars", () => {
		const args = buildRunArgs({
			image: "alpine:3.19",
			env: { FOO: "bar", QUANTDESK_RUN_ID: "run-9" },
		});
		expect(args).toContain("-e");
		expect(args).toContain("FOO=bar");
		expect(args).toContain("QUANTDESK_RUN_ID=run-9");
	});

	it("image comes after flags, command comes after image", () => {
		const args = buildRunArgs({
			image: "freqtradeorg/freqtrade:stable_2025.7",
			rm: true,
			volumes: ["/ws:/workspace"],
			command: ["backtesting", "--config", "config.json"],
		});
		const imageIdx = args.indexOf("freqtradeorg/freqtrade:stable_2025.7");
		const backtestingIdx = args.indexOf("backtesting");
		expect(imageIdx).toBeGreaterThan(0);
		expect(backtestingIdx).toBeGreaterThan(imageIdx);
	});
});

describe("parseLabelString", () => {
	it("empty", () => {
		expect(parseLabelString("")).toEqual({});
	});

	it("single label", () => {
		expect(parseLabelString("quantdesk.runId=abc")).toEqual({ "quantdesk.runId": "abc" });
	});

	it("multiple labels comma-separated", () => {
		expect(
			parseLabelString("quantdesk.runId=abc,quantdesk.engine=freqtrade,quantdesk.kind=paper"),
		).toEqual({
			"quantdesk.runId": "abc",
			"quantdesk.engine": "freqtrade",
			"quantdesk.kind": "paper",
		});
	});

	it("ignores malformed entries", () => {
		expect(parseLabelString("ok=1,broken,also=2")).toEqual({ ok: "1", also: "2" });
	});
});

describe("quantdeskLabels", () => {
	it("returns the three standard labels", () => {
		expect(
			quantdeskLabels({
				runId: "run-42",
				engine: "nautilus",
				kind: "paper",
			}),
		).toEqual({
			"quantdesk.runId": "run-42",
			"quantdesk.engine": "nautilus",
			"quantdesk.kind": "paper",
		});
	});
});

describe("engine images", () => {
	it("freqtrade and nautilus pinned", () => {
		expect(ENGINE_IMAGES.freqtrade).toMatch(/freqtradeorg\/freqtrade:/);
		expect(ENGINE_IMAGES.nautilus).toMatch(/nautilus_trader[@:]/);
	});

	it("no :latest tags", () => {
		for (const image of Object.values(ENGINE_IMAGES)) {
			expect(image).not.toMatch(/:latest$/);
		}
	});

	it("getEngineImage('freqtrade') returns pinned tag", () => {
		expect(getEngineImage("freqtrade")).toBe(ENGINE_IMAGES.freqtrade);
	});

	it("getEngineImage('generic') returns the pinned sandbox tag", () => {
		expect(getEngineImage("generic")).toBe(ENGINE_IMAGES.generic);
	});
});
