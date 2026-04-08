/**
 * Comment router.
 *
 * Historically this file carried an approve/reject router keyed on a
 * `pendingProposal` metadata object. CLAUDE.md rule #15 made approval
 * conversational: the agent asks in plain text, the user replies in plain
 * text, and the next agent turn emits a direct action marker. There is no
 * longer any "pending proposal" object to approve or reject, so the
 * router is empty.
 *
 * The file is kept to preserve the mount point in `server/src/index.ts`
 * and so future non-proposal comment-level endpoints have a place to
 * land. Remove the mount if nothing ever ends up here.
 */

import { Router } from "express";

const router = Router();

export default router;
