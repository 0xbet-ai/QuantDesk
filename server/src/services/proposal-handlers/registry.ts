/**
 * Proposal handler registry — the dispatch table behind the generic
 * `POST /api/comments/:id/approve` / `reject` router. Each proposal type
 * (`data_fetch`, `new_experiment`, `complete_experiment`, `validation`,
 * `go_paper`) registers exactly one handler here. Phase 04 wires the router
 * and the data-fetch handler; phases 05–07 and 11 register the rest.
 *
 * CLAUDE.md rule #15 — the dispatcher guarantees that every approve/reject
 * round-trip either retriggers the agent or posts an action-phrase system
 * comment via `systemComment()`. Handlers inherit this invariant: if a
 * handler cannot meet it, it is a bug.
 */

import { db } from "@quantdesk/db";
import { comments } from "@quantdesk/db/schema";
import { eq } from "drizzle-orm";

export type ProposalType =
	| "data_fetch"
	| "new_experiment"
	| "complete_experiment"
	| "validation"
	| "go_paper";

/** Shape of a `pendingProposal` metadata value. */
export interface PendingProposal {
	type: ProposalType;
	data: unknown;
}

/** Comment row with narrowed `metadata` shape. */
export interface CommentRecord {
	id: string;
	experimentId: string;
	author: string;
	content: string;
	metadata: Record<string, unknown> | null;
}

/** Context passed to each handler. */
export interface ProposalHandlerContext {
	comment: CommentRecord;
	proposal: PendingProposal;
}

/** Handler contract. `onReject` is optional — the default just retriggers. */
export interface ProposalHandler {
	type: ProposalType;
	onApprove(ctx: ProposalHandlerContext): Promise<void>;
	onReject(ctx: ProposalHandlerContext): Promise<void>;
}

const HANDLERS = new Map<ProposalType, ProposalHandler>();

export function registerProposalHandler(handler: ProposalHandler): void {
	if (HANDLERS.has(handler.type)) {
		throw new Error(`Proposal handler already registered for type "${handler.type}"`);
	}
	HANDLERS.set(handler.type, handler);
}

export function getProposalHandler(type: string): ProposalHandler | undefined {
	return HANDLERS.get(type as ProposalType);
}

/** Test-only: clear the registry so tests can register fresh handlers. */
export function resetProposalHandlers(): void {
	HANDLERS.clear();
}

/**
 * Load a comment by id and narrow its shape. Returns null if not found.
 */
export async function loadComment(commentId: string): Promise<CommentRecord | null> {
	const rows = await db.select().from(comments).where(eq(comments.id, commentId));
	const row = rows[0];
	if (!row) return null;
	return {
		id: row.id,
		experimentId: row.experimentId,
		author: row.author,
		content: row.content,
		metadata: row.metadata,
	};
}

/**
 * Extract the `pendingProposal` from a comment's metadata, if any.
 */
export function extractPendingProposal(
	metadata: Record<string, unknown> | null,
): PendingProposal | null {
	if (!metadata) return null;
	const pending = metadata.pendingProposal;
	if (!pending || typeof pending !== "object") return null;
	const obj = pending as { type?: unknown; data?: unknown };
	if (typeof obj.type !== "string") return null;
	return { type: obj.type as ProposalType, data: obj.data };
}

/**
 * Clear a comment's `pendingProposal` and record the resolution so the UI
 * stops rendering buttons and the user can't double-approve. This runs
 * before the handler executes so a crashed handler still prevents
 * double-click; any follow-up work goes through a fresh agent turn.
 */
export async function resolvePendingProposal(
	commentId: string,
	outcome: "approved" | "rejected",
): Promise<void> {
	const existing = await loadComment(commentId);
	if (!existing) return;
	const currentMetadata = existing.metadata ?? {};
	const pending = currentMetadata.pendingProposal;
	// Copy all keys except `pendingProposal`, then add `resolvedProposal`.
	// This avoids a `delete` (biome performance rule) while still ensuring
	// jsonb drops the key.
	const nextMetadata: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(currentMetadata)) {
		if (key === "pendingProposal") continue;
		nextMetadata[key] = value;
	}
	nextMetadata.resolvedProposal = pending ? { ...(pending as object), outcome } : { outcome };
	await db.update(comments).set({ metadata: nextMetadata }).where(eq(comments.id, commentId));
}
