import { db } from "@quantdesk/db";
import { comments } from "@quantdesk/db/schema";
import { eq } from "drizzle-orm";

interface CreateCommentInput {
	experimentId: string;
	author: string;
	content: string;
	runId?: string;
	metadata?: Record<string, unknown>;
}

export async function createComment(input: CreateCommentInput) {
	const [comment] = await db
		.insert(comments)
		.values({
			experimentId: input.experimentId,
			author: input.author,
			content: input.content,
			runId: input.runId ?? null,
			metadata: input.metadata ?? null,
		})
		.returning();

	return comment!;
}

export async function listComments(experimentId: string) {
	return db
		.select()
		.from(comments)
		.where(eq(comments.experimentId, experimentId))
		.orderBy(comments.createdAt);
}
