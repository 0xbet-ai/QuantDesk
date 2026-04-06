import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { type WebSocket, WebSocketServer } from "ws";
import { subscribeExperimentEvents } from "./live-events.js";

export function setupWebSocket(server: HttpServer) {
	const wss = new WebSocketServer({ noServer: true });

	server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
		const pathname = req.url ?? "";
		const match = pathname.match(/^\/api\/experiments\/([^/]+)\/events\/ws$/);

		if (!match) {
			socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
			socket.destroy();
			return;
		}

		wss.handleUpgrade(req, socket, head, (ws) => {
			(ws as WebSocket & { experimentId?: string }).experimentId = match[1];
			wss.emit("connection", ws, req);
		});
	});

	const cleanupByClient = new Map<WebSocket, () => void>();

	wss.on("connection", (ws: WebSocket) => {
		const experimentId = (ws as WebSocket & { experimentId?: string }).experimentId;
		if (!experimentId) {
			ws.close(1008, "Missing experiment ID");
			return;
		}

		const unsubscribe = subscribeExperimentEvents(experimentId, (event) => {
			if (ws.readyState === ws.OPEN) {
				ws.send(JSON.stringify(event));
			}
		});

		cleanupByClient.set(ws, unsubscribe);

		ws.on("close", () => {
			const cleanup = cleanupByClient.get(ws);
			if (cleanup) {
				cleanup();
				cleanupByClient.delete(ws);
			}
		});

		ws.on("error", () => {
			ws.terminate();
		});
	});

	return wss;
}
