/**
 * Actor middleware — determines the authenticated identity for each
 * request based on the deployment mode.
 *
 * `local_trusted` (default): every request is auto-authenticated as
 *   `{ userId: "local-user", isAdmin: true }`. No login required.
 *
 * `authenticated`: resolves session via Better Auth cookies. If no
 *   valid session, the request proceeds with `{ userId: null }` and
 *   protected routes return 401.
 */

import type { DeploymentMode } from "@quantdesk/shared";
import type { Request, RequestHandler } from "express";

export interface Actor {
	userId: string | null;
	email: string | null;
	name: string | null;
	isAdmin: boolean;
	source: "local_implicit" | "session" | "none";
}

declare global {
	// biome-ignore lint/style/noNamespace: Express augmentation
	namespace Express {
		interface Request {
			actor: Actor;
		}
	}
}

interface SessionResult {
	session: { id: string; userId: string } | null;
	user: { id: string; email: string | null; name: string | null } | null;
}

interface ActorMiddlewareOptions {
	deploymentMode: DeploymentMode;
	resolveSession?: (req: Request) => Promise<SessionResult | null>;
}

export function actorMiddleware(opts: ActorMiddlewareOptions): RequestHandler {
	return async (req, _res, next) => {
		// Local trusted mode: auto-admin, skip all auth checks.
		if (opts.deploymentMode === "local_trusted") {
			req.actor = {
				userId: "local-user",
				email: null,
				name: "Local User",
				isAdmin: true,
				source: "local_implicit",
			};
			next();
			return;
		}

		// Authenticated mode: try to resolve session from cookies.
		req.actor = {
			userId: null,
			email: null,
			name: null,
			isAdmin: false,
			source: "none",
		};

		if (opts.resolveSession) {
			try {
				const session = await opts.resolveSession(req);
				if (session?.user?.id) {
					req.actor = {
						userId: session.user.id,
						email: session.user.email,
						name: session.user.name,
						isAdmin: true, // first user = admin (simple model)
						source: "session",
					};
				}
			} catch {
				// Session resolution failed — proceed as unauthenticated.
			}
		}

		next();
	};
}

/**
 * Guard middleware: returns 401 if the request has no authenticated
 * actor. Use on routes that require login.
 */
export function requireAuth(): RequestHandler {
	return (req, res, next) => {
		if (!req.actor?.userId) {
			res.status(401).json({ error: "Authentication required" });
			return;
		}
		next();
	};
}
