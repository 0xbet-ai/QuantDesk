import { describe, expect, it, vi } from "vitest";
import { publishExperimentEvent, subscribeExperimentEvents } from "../live-events.js";

describe("live events", () => {
	it("client on experiment A receives events for A only", () => {
		const handlerA = vi.fn();
		const handlerB = vi.fn();

		subscribeExperimentEvents("exp-a", handlerA);
		subscribeExperimentEvents("exp-b", handlerB);

		publishExperimentEvent({
			experimentId: "exp-a",
			type: "comment.new",
			payload: { content: "hello" },
		});

		expect(handlerA).toHaveBeenCalledTimes(1);
		expect(handlerB).not.toHaveBeenCalled();
		expect(handlerA.mock.calls[0]![0].type).toBe("comment.new");
		expect(handlerA.mock.calls[0]![0].payload.content).toBe("hello");
	});

	it("comment.new contains full comment data", () => {
		const handler = vi.fn();
		subscribeExperimentEvents("exp-c", handler);

		const event = publishExperimentEvent({
			experimentId: "exp-c",
			type: "comment.new",
			payload: { id: "comment-1", author: "analytics", content: "Run done" },
		});

		expect(event.type).toBe("comment.new");
		expect(event.experimentId).toBe("exp-c");
		expect(event.payload.author).toBe("analytics");
		expect(event.id).toBeGreaterThan(0);
		expect(event.createdAt).toBeDefined();
	});

	it("run.status event is delivered", () => {
		const handler = vi.fn();
		subscribeExperimentEvents("exp-d", handler);

		publishExperimentEvent({
			experimentId: "exp-d",
			type: "run.status",
			payload: { runId: "run-1", status: "completed" },
		});

		expect(handler).toHaveBeenCalledTimes(1);
		expect(handler.mock.calls[0]![0].payload.status).toBe("completed");
	});

	it("unsubscribe stops receiving events", () => {
		const handler = vi.fn();
		const unsubscribe = subscribeExperimentEvents("exp-e", handler);

		publishExperimentEvent({ experimentId: "exp-e", type: "comment.new" });
		expect(handler).toHaveBeenCalledTimes(1);

		unsubscribe();
		publishExperimentEvent({ experimentId: "exp-e", type: "comment.new" });
		expect(handler).toHaveBeenCalledTimes(1);
	});
});
