import express from "express";
import { errorHandler } from "./middleware/error.js";
import desksRouter from "./routes/desks.js";
import experimentsRouter from "./routes/experiments.js";
import runsRouter from "./routes/runs.js";
import strategiesRouter from "./routes/strategies.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(express.json());

app.get("/api/health", (_req, res) => {
	res.json({ status: "ok" });
});

app.use("/api/desks", desksRouter);
app.use("/api/experiments", experimentsRouter);
app.use("/api/runs", runsRouter);
app.use("/api/strategies", strategiesRouter);

app.use(errorHandler);

app.listen(port, () => {
	console.log(`QuantDesk server listening on port ${port}`);
});

export { app };
