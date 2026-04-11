import { spawn } from "node:child_process";

/**
 * Thin wrapper around the Docker CLI.
 *
 * QuantDesk uses Docker only as an engine executor runtime. This module
 * centralises the shell-out so the adapters don't each reinvent argument
 * assembly, label conventions, and error parsing.
 *
 * Design notes:
 *   - We shell out to the `docker` binary rather than using a Dockerode-style
 *     daemon client. That keeps the dependency footprint small and matches
 *     how most users interact with Docker locally. The cost is slightly
 *     noisier error handling (strings vs typed errors).
 *   - Long-lived paper containers are labeled with `quantdesk.*` so we can
 *     reconcile state after a server restart via `listByLabel`.
 *   - All methods throw on non-zero exit with stderr attached.
 */

export interface DockerRunOptions {
	image: string;
	/** Command + args passed to `docker run` after the image. */
	command?: string[];
	/** Container name. Must be unique; use `quantdesk-<kind>-<runId>`. */
	name?: string;
	/** Labels attached to the container (key/value). */
	labels?: Record<string, string>;
	/** Bind mounts: hostPath:containerPath[:ro]. */
	volumes?: string[];
	/**
	 * tmpfs mounts: containerPath[:options]. Used to shadow sub-paths of a
	 * bind-mounted workspace so the container cannot touch host files there
	 * (e.g. `.git/objects` — freqtrade's entrypoint chowns user_data and
	 * fails noisily on git's read-only host-owned files).
	 */
	tmpfs?: string[];
	/** Host:container port mappings, e.g. `["8080:8080"]`. */
	ports?: string[];
	/** Environment variables. */
	env?: Record<string, string>;
	/** Remove container on exit. */
	rm?: boolean;
	/** Detach — return immediately instead of streaming output. */
	detach?: boolean;
	/** Per-container resource limits. */
	cpus?: string;
	memory?: string;
	pidsLimit?: number;
	/** Working directory inside the container. */
	workdir?: string;
	/** Network mode. Default bridge. */
	network?: string;
}

export interface RunResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export class DockerError extends Error {
	constructor(
		message: string,
		public readonly exitCode: number,
		public readonly stderr: string,
	) {
		super(message);
		this.name = "DockerError";
	}
}

/** Optional callbacks for line-buffered stdout / stderr forwarding. */
export interface ExecStreamOptions {
	onStdoutLine?: (line: string) => void;
	onStderrLine?: (line: string) => void;
}

async function exec(args: string[], stream: ExecStreamOptions = {}): Promise<RunResult> {
	return new Promise((resolve, reject) => {
		const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		let stdoutBuffer = "";
		let stderrBuffer = "";

		const flushLines = (buffer: string, cb: ((line: string) => void) | undefined): string => {
			if (!cb) return buffer;
			let remainder = buffer;
			let idx = remainder.indexOf("\n");
			while (idx !== -1) {
				const line = remainder.slice(0, idx).replace(/\r$/, "");
				if (line) cb(line);
				remainder = remainder.slice(idx + 1);
				idx = remainder.indexOf("\n");
			}
			return remainder;
		};

		child.stdout.on("data", (chunk) => {
			const text = chunk.toString();
			stdout += text;
			if (stream.onStdoutLine) {
				stdoutBuffer = flushLines(stdoutBuffer + text, stream.onStdoutLine);
			}
		});
		child.stderr.on("data", (chunk) => {
			const text = chunk.toString();
			stderr += text;
			if (stream.onStderrLine) {
				stderrBuffer = flushLines(stderrBuffer + text, stream.onStderrLine);
			}
		});
		child.on("error", reject);
		child.on("close", (code) => {
			// Flush any trailing partial line on stream callbacks.
			if (stream.onStdoutLine && stdoutBuffer) stream.onStdoutLine(stdoutBuffer.trimEnd());
			if (stream.onStderrLine && stderrBuffer) stream.onStderrLine(stderrBuffer.trimEnd());
			resolve({ stdout, stderr, exitCode: code ?? 0 });
		});
	});
}

/**
 * Pull an image by exact tag. Idempotent — pulling an already-present image
 * is a no-op (besides a manifest check).
 */
export async function pullImage(image: string): Promise<void> {
	const result = await exec(["pull", image]);
	if (result.exitCode !== 0) {
		throw new DockerError(
			`Failed to pull image ${image}: exit ${result.exitCode}`,
			result.exitCode,
			result.stderr,
		);
	}
}

/**
 * Check whether an image tag is already present locally without pulling.
 */
export async function hasImage(image: string): Promise<boolean> {
	const result = await exec(["image", "inspect", image]);
	return result.exitCode === 0;
}

/**
 * Run a container and wait for it to exit. Use for ephemeral work
 * (backtest, data download). For long-lived containers use {@link runDetached}.
 *
 * Pass `stream` callbacks to forward stdout/stderr line-by-line in real
 * time (used by `executeDataFetch` to push freqtrade download progress
 * into the UI). The callbacks fire in addition to the buffered
 * `stdout` / `stderr` strings on the resolved `RunResult` — no behaviour
 * change for callers that omit the option.
 */
export async function runContainer(
	opts: DockerRunOptions,
	stream: ExecStreamOptions = {},
): Promise<RunResult> {
	const args = buildRunArgs({ ...opts, detach: false });

	// Periodically log container resource usage when a name is set.
	let statsInterval: ReturnType<typeof setInterval> | undefined;
	if (opts.name) {
		statsInterval = setInterval(async () => {
			try {
				const s = await exec([
					"stats",
					"--no-stream",
					"--format",
					"{{.Name}}\tCPU={{.CPUPerc}}\tMEM={{.MemUsage}}\tMEM%={{.MemPerc}}",
					opts.name!,
				]);
				const line = s.stdout.trim();
				if (line) console.log(`[docker-stats] ${line}`);
			} catch {
				/* container may have exited between ticks */
			}
		}, 5_000);
	}

	try {
		return await exec(args, stream);
	} finally {
		if (statsInterval) clearInterval(statsInterval);
	}
}

/**
 * Start a detached container. Returns the container ID printed by Docker.
 * Use for long-lived work (paper trading). Combine with {@link listByLabel}
 * to reconcile on restart.
 */
export async function runDetached(opts: DockerRunOptions): Promise<string> {
	const args = buildRunArgs({ ...opts, detach: true });
	const result = await exec(args);
	if (result.exitCode !== 0) {
		throw new DockerError(
			`docker run failed: ${result.stderr.trim() || "unknown error"}`,
			result.exitCode,
			result.stderr,
		);
	}
	return result.stdout.trim(); // container ID
}

/**
 * Exec a command inside a running container.
 */
export async function execInContainer(
	containerName: string,
	command: string[],
): Promise<RunResult> {
	return exec(["exec", containerName, ...command]);
}

/**
 * Fetch stdout+stderr logs from a running (or recently exited) container.
 * `tail` limits to the last N lines; omit for full log.
 */
export async function logsFrom(
	containerName: string,
	opts: { tail?: number; since?: string } = {},
): Promise<RunResult> {
	const args = ["logs"];
	if (opts.tail !== undefined) args.push("--tail", String(opts.tail));
	if (opts.since) args.push("--since", opts.since);
	args.push(containerName);
	return exec(args);
}

/**
 * Send SIGTERM and wait for graceful shutdown, escalating to SIGKILL after
 * `timeoutSec` seconds. Mirrors `docker stop -t` semantics.
 */
export async function stopContainer(containerName: string, timeoutSec = 10): Promise<void> {
	const result = await exec(["stop", "-t", String(timeoutSec), containerName]);
	if (result.exitCode !== 0 && !/No such container/i.test(result.stderr)) {
		throw new DockerError(
			`docker stop failed for ${containerName}: ${result.stderr.trim()}`,
			result.exitCode,
			result.stderr,
		);
	}
}

/**
 * Remove a stopped container. Idempotent — succeeds if the container is
 * already gone.
 */
export async function removeContainer(containerName: string): Promise<void> {
	const result = await exec(["rm", "-f", containerName]);
	if (result.exitCode !== 0 && !/No such container/i.test(result.stderr)) {
		throw new DockerError(
			`docker rm failed for ${containerName}: ${result.stderr.trim()}`,
			result.exitCode,
			result.stderr,
		);
	}
}

export interface ContainerSummary {
	id: string;
	name: string;
	labels: Record<string, string>;
	state: string;
}

/**
 * List containers matching a single `label=value` filter. Used by the paper
 * registry to rebuild in-memory state from Docker on server restart.
 */
export async function listByLabel(labelFilter: string): Promise<ContainerSummary[]> {
	const result = await exec([
		"ps",
		"--all", // include stopped so we can detect crashed paper runs
		"--filter",
		`label=${labelFilter}`,
		"--format",
		"{{json .}}",
	]);
	if (result.exitCode !== 0) {
		throw new DockerError(
			`docker ps failed: ${result.stderr.trim()}`,
			result.exitCode,
			result.stderr,
		);
	}
	const lines = result.stdout.split("\n").filter((l) => l.trim());
	return lines.map((line) => {
		const raw = JSON.parse(line) as {
			ID: string;
			Names: string;
			Labels: string;
			State: string;
		};
		return {
			id: raw.ID,
			name: raw.Names,
			labels: parseLabelString(raw.Labels),
			state: raw.State,
		};
	});
}

/**
 * Check if the Docker daemon is reachable. Fail fast with a clear message
 * instead of letting adapters explode with cryptic pipe errors.
 */
export async function ensureDockerAvailable(): Promise<void> {
	const result = await exec(["info", "--format", "{{.ServerVersion}}"]);
	if (result.exitCode !== 0) {
		throw new DockerError(
			"Docker daemon is not reachable. Is Docker Desktop running?",
			result.exitCode,
			result.stderr,
		);
	}
}

export function buildRunArgs(opts: DockerRunOptions): string[] {
	const args: string[] = ["run"];
	if (opts.detach) args.push("-d");
	if (opts.rm) args.push("--rm");
	if (opts.name) args.push("--name", opts.name);
	if (opts.workdir) args.push("--workdir", opts.workdir);
	if (opts.network) args.push("--network", opts.network);
	if (opts.cpus) args.push(`--cpus=${opts.cpus}`);
	if (opts.memory) args.push(`--memory=${opts.memory}`);
	if (opts.pidsLimit !== undefined) args.push(`--pids-limit=${opts.pidsLimit}`);
	for (const [k, v] of Object.entries(opts.labels ?? {})) {
		args.push("--label", `${k}=${v}`);
	}
	for (const mount of opts.volumes ?? []) {
		args.push("-v", mount);
	}
	for (const mount of opts.tmpfs ?? []) {
		args.push("--tmpfs", mount);
	}
	for (const port of opts.ports ?? []) {
		args.push("-p", port);
	}
	for (const [k, v] of Object.entries(opts.env ?? {})) {
		args.push("-e", `${k}=${v}`);
	}
	args.push(opts.image);
	if (opts.command && opts.command.length > 0) {
		args.push(...opts.command);
	}
	return args;
}

export function parseLabelString(raw: string): Record<string, string> {
	const out: Record<string, string> = {};
	if (!raw) return out;
	for (const entry of raw.split(",")) {
		const eq = entry.indexOf("=");
		if (eq === -1) continue;
		const key = entry.slice(0, eq).trim();
		const value = entry.slice(eq + 1).trim();
		out[key] = value;
	}
	return out;
}

/** Standard labels applied to all QuantDesk-managed containers. */
export function quantdeskLabels(params: {
	runId: string;
	engine: "freqtrade" | "nautilus" | "generic";
	kind: "paper" | "backtest" | "script";
}): Record<string, string> {
	return {
		"quantdesk.runId": params.runId,
		"quantdesk.engine": params.engine,
		"quantdesk.kind": params.kind,
	};
}
