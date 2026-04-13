/**
 * Minimal self-contained auth system — email/password with cookie sessions.
 *
 * Replaces Better Auth (which caused drizzle-orm type conflicts in the
 * pnpm monorepo via its kysely transitive dependency). ~150 lines, zero
 * external auth deps, uses the existing drizzle DB + bcryptjs.
 *
 * Tables: `auth_users` + `auth_sessions` (created via drizzle migration).
 * Session tokens are stored in a secure httpOnly cookie.
 *
 * Only active when `deploymentMode === "authenticated"`.
 */

import { randomUUID } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import { hashSync, compareSync } from "bcryptjs";
import { db } from "@quantdesk/db";
import { authSessions, authUsers } from "@quantdesk/db/schema";
import { eq } from "drizzle-orm";

// ── Session helpers ─────────────────────────────────────────────────

const SESSION_COOKIE = "quantdesk_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface AuthSessionResult {
	session: { id: string; userId: string } | null;
	user: { id: string; email: string | null; name: string | null } | null;
}

function setSessionCookie(res: Response, token: string): void {
	res.cookie(SESSION_COOKIE, token, {
		httpOnly: true,
		sameSite: "lax",
		secure: false, // local dev — set true behind HTTPS reverse proxy
		maxAge: SESSION_TTL_MS,
		path: "/",
	});
}

function clearSessionCookie(res: Response): void {
	res.clearCookie(SESSION_COOKIE, { path: "/" });
}

function getSessionToken(req: Request): string | null {
	return (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE] ?? null;
}

// ── Route handlers ──────────────────────────────────────────────────

export function createAuthRouter(opts: { disableSignUp: boolean }): RequestHandler {
	return async (req, res) => {
		const path = req.path; // e.g. "/sign-in/email", "/sign-up/email", "/sign-out", "/get-session"

		try {
			// ── Sign Up ───────────────────────────────────────────────
			if (path === "/sign-up/email" && req.method === "POST") {
				if (opts.disableSignUp) {
					res.status(403).json({ error: "Sign-up is disabled" });
					return;
				}
				const { email, password, name } = req.body as {
					email?: string;
					password?: string;
					name?: string;
				};
				if (!email || !password) {
					res.status(400).json({ error: "Email and password required" });
					return;
				}
				const existing = await db
					.select({ id: authUsers.id })
					.from(authUsers)
					.where(eq(authUsers.email, email.toLowerCase()))
					.limit(1);
				if (existing.length > 0) {
					res.status(409).json({ error: "Email already registered" });
					return;
				}
				const passwordHash = hashSync(password, 10);
				const [user] = await db
					.insert(authUsers)
					.values({ email: email.toLowerCase(), name: name || null, passwordHash })
					.returning();
				const token = randomUUID();
				await db.insert(authSessions).values({
					userId: user!.id,
					token,
					expiresAt: new Date(Date.now() + SESSION_TTL_MS),
				});
				setSessionCookie(res, token);
				res.json({
					session: { id: token, userId: user!.id },
					user: { id: user!.id, email: user!.email, name: user!.name },
				});
				return;
			}

			// ── Sign In ───────────────────────────────────────────────
			if (path === "/sign-in/email" && req.method === "POST") {
				const { email, password } = req.body as { email?: string; password?: string };
				if (!email || !password) {
					res.status(400).json({ error: "Email and password required" });
					return;
				}
				const [user] = await db
					.select()
					.from(authUsers)
					.where(eq(authUsers.email, email.toLowerCase()))
					.limit(1);
				if (!user || !compareSync(password, user.passwordHash)) {
					res.status(401).json({ error: "Invalid credentials" });
					return;
				}
				const token = randomUUID();
				await db.insert(authSessions).values({
					userId: user.id,
					token,
					expiresAt: new Date(Date.now() + SESSION_TTL_MS),
				});
				setSessionCookie(res, token);
				res.json({
					session: { id: token, userId: user.id },
					user: { id: user.id, email: user.email, name: user.name },
				});
				return;
			}

			// ── Get Session ───────────────────────────────────────────
			if (path === "/get-session") {
				const token = getSessionToken(req);
				if (!token) {
					res.status(401).json({ error: "No session" });
					return;
				}
				const [session] = await db
					.select()
					.from(authSessions)
					.where(eq(authSessions.token, token))
					.limit(1);
				if (!session || session.expiresAt < new Date()) {
					clearSessionCookie(res);
					res.status(401).json({ error: "Session expired" });
					return;
				}
				const [user] = await db
					.select()
					.from(authUsers)
					.where(eq(authUsers.id, session.userId))
					.limit(1);
				if (!user) {
					clearSessionCookie(res);
					res.status(401).json({ error: "User not found" });
					return;
				}
				res.json({
					session: { id: session.id, userId: session.userId },
					user: { id: user.id, email: user.email, name: user.name },
				});
				return;
			}

			// ── Sign Out ──────────────────────────────────────────────
			if (path === "/sign-out" && req.method === "POST") {
				const token = getSessionToken(req);
				if (token) {
					await db.delete(authSessions).where(eq(authSessions.token, token));
				}
				clearSessionCookie(res);
				res.json({ ok: true });
				return;
			}

			res.status(404).json({ error: "Not found" });
		} catch (err) {
			console.error("[auth]", err);
			res.status(500).json({ error: "Internal auth error" });
		}
	};
}

// ── Session resolver for middleware ──────────────────────────────────

export async function resolveSession(req: Request): Promise<AuthSessionResult | null> {
	const token = getSessionToken(req);
	if (!token) return null;

	const [session] = await db
		.select()
		.from(authSessions)
		.where(eq(authSessions.token, token))
		.limit(1);
	if (!session || session.expiresAt < new Date()) return null;

	const [user] = await db
		.select()
		.from(authUsers)
		.where(eq(authUsers.id, session.userId))
		.limit(1);
	if (!user) return null;

	return {
		session: { id: session.id, userId: session.userId },
		user: { id: user.id, email: user.email, name: user.name },
	};
}
