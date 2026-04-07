import { FreqtradeAdapter } from "./freqtrade/adapter.js";
import { GenericAdapter } from "./generic/adapter.js";
import { NautilusAdapter } from "./nautilus/adapter.js";
import type { EngineAdapter } from "./types.js";

const adapters: Record<string, EngineAdapter> = {
	freqtrade: new FreqtradeAdapter(),
	nautilus: new NautilusAdapter(),
	generic: new GenericAdapter(),
};

export function getAdapter(engine: string): EngineAdapter {
	const adapter = adapters[engine];
	if (!adapter) {
		throw new Error(`Unknown engine: ${engine}`);
	}
	return adapter;
}
