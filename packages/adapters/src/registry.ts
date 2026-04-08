import { ClaudeAdapter } from "./claude/adapter.js";
import { CodexAdapter } from "./codex/adapter.js";
import { MockAdapter } from "./mock/adapter.js";
import type { AgentAdapter } from "./types.js";

const adapters: Record<string, AgentAdapter> = {
	claude: new ClaudeAdapter(),
	codex: new CodexAdapter(),
	mock: new MockAdapter(),
};

export function getAgentAdapter(type: string): AgentAdapter {
	const adapter = adapters[type];
	if (!adapter) {
		throw new Error(`Unknown agent adapter: ${type}`);
	}
	return adapter;
}
