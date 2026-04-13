/**
 * Auth API client — mirrors Paperclip's ui/src/api/auth.ts.
 * Only used when deploymentMode === "authenticated".
 */

export interface AuthSession {
	session: { id: string; userId: string };
	user: { id: string; email: string | null; name: string | null };
}

function toSession(value: unknown): AuthSession | null {
	if (!value || typeof value !== "object") return null;
	const r = value as Record<string, unknown>;
	const s = r.session as Record<string, unknown> | null;
	const u = r.user as Record<string, unknown> | null;
	if (!s || typeof s.id !== "string" || typeof s.userId !== "string") return null;
	if (!u || typeof u.id !== "string") return null;
	return {
		session: { id: s.id, userId: s.userId },
		user: {
			id: u.id,
			email: typeof u.email === "string" ? u.email : null,
			name: typeof u.name === "string" ? u.name : null,
		},
	};
}

async function authPost(path: string, body: Record<string, unknown>) {
	const res = await fetch(`/api/auth${path}`, {
		method: "POST",
		credentials: "include",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const payload = await res.json().catch(() => null);
	if (!res.ok) {
		const msg =
			payload && typeof payload === "object" && "error" in payload
				? typeof (payload as Record<string, unknown>).error === "string"
					? (payload as { error: string }).error
					: "Request failed"
				: `Request failed: ${res.status}`;
		throw new Error(msg);
	}
	return payload;
}

export const authApi = {
	getSession: async (): Promise<AuthSession | null> => {
		const res = await fetch("/api/auth/get-session", {
			credentials: "include",
			headers: { Accept: "application/json" },
		});
		if (res.status === 401) return null;
		const payload = await res.json().catch(() => null);
		if (!res.ok) return null;
		const direct = toSession(payload);
		if (direct) return direct;
		const nested =
			payload && typeof payload === "object"
				? toSession((payload as Record<string, unknown>).data)
				: null;
		return nested;
	},

	signInEmail: async (input: { email: string; password: string }) => {
		await authPost("/sign-in/email", input);
	},

	signUpEmail: async (input: { name: string; email: string; password: string }) => {
		await authPost("/sign-up/email", input);
	},

	signOut: async () => {
		await authPost("/sign-out", {});
	},
};
