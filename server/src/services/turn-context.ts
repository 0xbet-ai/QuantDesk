import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Phase 27 — AsyncLocalStorage carrying the current `agent_turns.id` through
 * the call stack of a single `triggerAgent` invocation. Downstream helpers
 * (`createComment`, run inserts inside agent-trigger, future data-fetch progress
 * rows) pull `turnId` from here so we don't have to thread the id through
 * every call site. Outside of a turn the context is `undefined` and all
 * helpers fall back to leaving `turn_id` null.
 */
export interface TurnContext {
	turnId: string;
}

export const turnContextStore = new AsyncLocalStorage<TurnContext>();

export function getCurrentTurnId(): string | undefined {
	return turnContextStore.getStore()?.turnId;
}

export function runWithTurn<T>(turnId: string, fn: () => Promise<T>): Promise<T> {
	return turnContextStore.run({ turnId }, fn);
}
