import { EventEmitter } from "node:events";

export interface LiveEvent {
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
		// Line-buffered freqtrade stdout/stderr forwarded from the paper
		// container. Payload: { sessionId, stream: "stdout"|"stderr", line }.
		| "paper.log"
		// Agent called `new_experiment`: the old experiment is closed and a
		// new one was created. Published on the OLD experiment's channel so
		// the UI that's still viewing it can auto-navigate.
		// Payload: { newExperimentId, newTitle, newNumber }.
		| "experiment.created";
	payload: Record<string, unknown>;
	createdAt: string;
}

type LiveEventListener = (event: LiveEvent) => void;

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

let nextEventId = 0;

export function publishExperimentEvent(input: {
	experimentId: string;
	type: LiveEvent["type"];
	payload?: Record<string, unknown>;
}): LiveEvent {
	nextEventId += 1;
	const event: LiveEvent = {
		id: nextEventId,
		experimentId: input.experimentId,
		type: input.type,
		payload: input.payload ?? {},
		createdAt: new Date().toISOString(),
	};
	emitter.emit(input.experimentId, event);
	return event;
}

export function subscribeExperimentEvents(
	experimentId: string,
	listener: LiveEventListener,
): () => void {
	emitter.on(experimentId, listener);
	return () => {
		emitter.off(experimentId, listener);
	};
}
