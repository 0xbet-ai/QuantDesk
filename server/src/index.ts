import express from "express";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(express.json());

app.get("/api/health", (_req, res) => {
	res.json({ status: "ok" });
});

app.listen(port, () => {
	console.log(`QuantDesk server listening on port ${port}`);
});
