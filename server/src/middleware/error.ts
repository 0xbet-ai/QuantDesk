import type { ErrorRequestHandler } from "express";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
	const message = err instanceof Error ? err.message : "Internal server error";
	const status = err.status ?? 500;
	res.status(status).json({ error: message });
};

export class HttpError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}
