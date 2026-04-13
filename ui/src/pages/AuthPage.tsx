import { useState } from "react";
import { useTranslation } from "react-i18next";
import { authApi } from "../lib/auth.js";

interface Props {
	onAuthenticated: () => void;
}

export function AuthPage({ onAuthenticated }: Props) {
	const [mode, setMode] = useState<"signin" | "signup">("signin");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const { t } = useTranslation();

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);
		setLoading(true);
		try {
			if (mode === "signup") {
				await authApi.signUpEmail({ name: name || email.split("@")[0] || "User", email, password });
			} else {
				await authApi.signInEmail({ email, password });
			}
			onAuthenticated();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Authentication failed");
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="min-h-screen flex items-center justify-center bg-background">
			<div className="w-full max-w-sm space-y-6 px-4">
				<div className="text-center space-y-2">
					<h1 className="text-2xl font-bold tracking-tight">{t("layout.appName")}</h1>
					<p className="text-sm text-muted-foreground">
						{mode === "signin" ? t("auth.signInTitle") : t("auth.signUpTitle")}
					</p>
				</div>

				<form onSubmit={handleSubmit} className="space-y-4">
					{mode === "signup" && (
						<div>
							<label className="text-sm font-medium" htmlFor="name">
								Name
							</label>
							<input
								id="name"
								type="text"
								value={name}
								onChange={(e) => setName(e.target.value)}
								className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
								placeholder="Your name"
							/>
						</div>
					)}
					<div>
						<label className="text-sm font-medium" htmlFor="email">
							Email
						</label>
						<input
							id="email"
							type="email"
							required
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
							placeholder="you@example.com"
						/>
					</div>
					<div>
						<label className="text-sm font-medium" htmlFor="password">
							Password
						</label>
						<input
							id="password"
							type="password"
							required
							minLength={8}
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
							placeholder="8+ characters"
						/>
					</div>

					{error && (
						<div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-md px-3 py-2">
							{error}
						</div>
					)}

					<button
						type="submit"
						disabled={loading}
						className="w-full rounded-md bg-foreground text-background py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
					>
						{loading ? "..." : mode === "signin" ? t("auth.signIn") : t("auth.signUp")}
					</button>
				</form>

				<div className="text-center text-sm text-muted-foreground">
					{mode === "signin" ? (
						<>
							No account?{" "}
							<button
								type="button"
								onClick={() => setMode("signup")}
								className="text-foreground underline"
							>
								Sign up
							</button>
						</>
					) : (
						<>
							Already have an account?{" "}
							<button
								type="button"
								onClick={() => setMode("signin")}
								className="text-foreground underline"
							>
								Sign in
							</button>
						</>
					)}
				</div>
			</div>
		</div>
	);
}
