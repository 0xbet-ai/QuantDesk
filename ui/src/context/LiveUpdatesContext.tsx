import { createContext, useCallback, useContext, useEffect, useRef } from "react";
import type { ReactNode } from "react";

interface LiveEvent {
	id: number;
	experimentId: string;
	type: "comment.new" | "run.status" | "run.live" | "agent.thinking" | "agent.done";
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

	const subscribe = useCallback((experimentId: string, handler: EventHandler) => {
		// Register handler
		let handlers = handlersRef.current.get(experimentId);
		if (!handlers) {
			handlers = new Set();
			handlersRef.current.set(experimentId, handlers);
		}
		handlers.add(handler);

		// Create WebSocket if needed
		if (!socketsRef.current.has(experimentId)) {
			const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
			const host = window.location.host;
			const ws = new WebSocket(`${protocol}//${host}/api/experiments/${experimentId}/events/ws`);

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
			};

			socketsRef.current.set(experimentId, ws);
		}

		// Unsubscribe
		return () => {
			handlers?.delete(handler);
			if (handlers?.size === 0) {
				handlersRef.current.delete(experimentId);
				const ws = socketsRef.current.get(experimentId);
				if (ws) {
					ws.close();
					socketsRef.current.delete(experimentId);
				}
			}
		};
	}, []);

	// Cleanup all on unmount
	useEffect(() => {
		return () => {
			for (const ws of socketsRef.current.values()) {
				ws.close();
			}
			socketsRef.current.clear();
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
