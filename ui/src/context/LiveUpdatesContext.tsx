import { createContext, useCallback, useContext, useEffect, useRef } from "react";
import type { ReactNode } from "react";

interface LiveEvent {
	id: number;
	experimentId: string;
	type:
		| "comment.new"
		| "run.status"
		| "run.paper"
		| "agent.thinking"
		| "agent.streaming"
		| "agent.done"
		| "experiment.updated"
		| "data_fetch.progress"
		| "turn.status"
		| "run.log_chunk"
		| "paper.status"
		| "paper.log";
	payload: Record<string, unknown>;
	createdAt: string;
}

type EventHandler = (event: LiveEvent) => void;

interface LiveUpdatesContextValue {
	subscribe: (experimentId: string, handler: EventHandler) => () => void;
}

const LiveUpdatesContext = createContext<LiveUpdatesContextValue | undefined>(undefined);

export function LiveUpdatesProvider({ children }: { children: ReactNode }) {
	const socketsRef = useRef<Map<string, WebSocket>>(new Map());
	const handlersRef = useRef<Map<string, Set<EventHandler>>>(new Map());
	const reconnectTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
	const reconnectAttemptsRef = useRef<Map<string, number>>(new Map());
	// Track cleanly-closed experiments so we don't reconnect after an
	// explicit unsubscribe (React StrictMode double-invokes effects).
	const intentionallyClosedRef = useRef<Set<string>>(new Set());

	const openSocket = useCallback((experimentId: string) => {
		if (socketsRef.current.has(experimentId)) return;
		intentionallyClosedRef.current.delete(experimentId);

		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
		const host = window.location.host;
		const ws = new WebSocket(`${protocol}//${host}/api/experiments/${experimentId}/events/ws`);

		ws.onopen = () => {
			// Successful connection — reset backoff for next failure.
			reconnectAttemptsRef.current.delete(experimentId);
		};

		ws.onmessage = (e) => {
			try {
				const event: LiveEvent = JSON.parse(e.data);
				const currentHandlers = handlersRef.current.get(experimentId);
				if (currentHandlers) {
					for (const h of currentHandlers) {
						h(event);
					}
				}
			} catch {
				/* ignore parse errors */
			}
		};

		ws.onclose = () => {
			socketsRef.current.delete(experimentId);
			// Only reconnect if there are still handlers AND the close
			// wasn't triggered by a caller-initiated unsubscribe. This
			// covers the common case where tsx-watch restarted the
			// dev server and the WebSocket died on our end — without
			// auto-reconnect the user has to hard-refresh to see events
			// again (the exact bug that hid the paper.log stream until
			// now).
			if (intentionallyClosedRef.current.has(experimentId)) {
				intentionallyClosedRef.current.delete(experimentId);
				return;
			}
			const handlers = handlersRef.current.get(experimentId);
			if (!handlers || handlers.size === 0) return;

			const attempt = (reconnectAttemptsRef.current.get(experimentId) ?? 0) + 1;
			reconnectAttemptsRef.current.set(experimentId, attempt);
			// Exponential backoff capped at 10s: 500ms, 1s, 2s, 4s, 8s, 10s...
			const delay = Math.min(500 * 2 ** (attempt - 1), 10_000);
			const timer = setTimeout(() => {
				reconnectTimersRef.current.delete(experimentId);
				// Handlers may have unsubscribed while we were waiting.
				const stillHasHandlers = (handlersRef.current.get(experimentId)?.size ?? 0) > 0;
				if (stillHasHandlers) openSocket(experimentId);
			}, delay);
			reconnectTimersRef.current.set(experimentId, timer);
		};

		socketsRef.current.set(experimentId, ws);
	}, []);

	const subscribe = useCallback(
		(experimentId: string, handler: EventHandler) => {
			let handlers = handlersRef.current.get(experimentId);
			if (!handlers) {
				handlers = new Set();
				handlersRef.current.set(experimentId, handlers);
			}
			handlers.add(handler);

			openSocket(experimentId);

			return () => {
				const currentHandlers = handlersRef.current.get(experimentId);
				currentHandlers?.delete(handler);
				if (currentHandlers?.size === 0) {
					handlersRef.current.delete(experimentId);
					// Mark this close as intentional so onclose doesn't
					// schedule a reconnect.
					intentionallyClosedRef.current.add(experimentId);
					const ws = socketsRef.current.get(experimentId);
					if (ws) {
						ws.close();
						socketsRef.current.delete(experimentId);
					}
					const pendingTimer = reconnectTimersRef.current.get(experimentId);
					if (pendingTimer) {
						clearTimeout(pendingTimer);
						reconnectTimersRef.current.delete(experimentId);
					}
					reconnectAttemptsRef.current.delete(experimentId);
				}
			};
		},
		[openSocket],
	);

	// Cleanup all on unmount
	useEffect(() => {
		const sockets = socketsRef.current;
		const timers = reconnectTimersRef.current;
		return () => {
			for (const ws of sockets.values()) {
				ws.close();
			}
			sockets.clear();
			for (const timer of timers.values()) {
				clearTimeout(timer);
			}
			timers.clear();
		};
	}, []);

	return (
		<LiveUpdatesContext.Provider value={{ subscribe }}>{children}</LiveUpdatesContext.Provider>
	);
}

export function useLiveUpdates(experimentId: string | null, handler: EventHandler) {
	const ctx = useContext(LiveUpdatesContext);
	const handlerRef = useRef(handler);
	handlerRef.current = handler;

	useEffect(() => {
		if (!ctx || !experimentId) return;
		return ctx.subscribe(experimentId, (event) => handlerRef.current(event));
	}, [ctx, experimentId]);
}
