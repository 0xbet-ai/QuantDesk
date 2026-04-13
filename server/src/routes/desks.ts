import { Router } from "express";
import { HttpError } from "../middleware/error.js";
import { listActivity } from "../services/activity.js";
import { getActiveAgentExperimentIds, triggerAgent } from "../services/agent-trigger.js";
import {
	createDataset,
	deleteDataset,
	listDatasets,
	previewDataset,
} from "../services/datasets.js";
import { exportDesk, importDesk } from "../services/desk-package.js";
import { archiveDesk, createDesk, getDesk, listDesks, updateDesk } from "../services/desks.js";
import { createExperiment, listExperiments } from "../services/experiments.js";
import { getCode, getDiff, getLog, listFiles } from "../services/workspace.js";

const router = Router();

router.post("/", async (req, res, next) => {
	try {
		const result = await createDesk(req.body);
		res.status(201).json(result);

		// Trigger agent for baseline experiment (async, don't block response)
		triggerAgent(result.experiment.id).catch((err) => {
			console.error("Agent trigger on desk creation failed:", err);
		});
	} catch (err) {
		next(err);
	}
});

router.get("/", async (_req, res, next) => {
	try {
		const result = await listDesks();
		res.json(result);
	} catch (err) {
		next(err);
	}
});

router.get("/:id", async (req, res, next) => {
	try {
		const desk = await getDesk(req.params.id);
		if (!desk) throw new HttpError(404, "Desk not found");
		res.json(desk);
	} catch (err) {
		next(err);
	}
});

router.patch("/:id", async (req, res, next) => {
	try {
		if ("engine" in req.body || "strategyMode" in req.body || "strategy_mode" in req.body) {
			throw new HttpError(400, "engine and strategy_mode are immutable for an existing desk");
		}
		const desk = await updateDesk(req.params.id, req.body);
		if (!desk) throw new HttpError(404, "Desk not found");
		res.json(desk);
	} catch (err) {
		next(err);
	}
});

router.get("/:id/experiments", async (req, res, next) => {
	try {
		const result = await listExperiments(req.params.id);
		res.json(result);
	} catch (err) {
		next(err);
	}
});

/**
 * Sidebar live indicator: which experiments in this desk currently have an
 * agent subprocess running. Read from the in-memory `activeAgents` map in
 * agent-trigger — no DB hit. The sidebar polls this every couple seconds
 * instead of opening a WebSocket per experiment row.
 */
router.get("/:id/active-experiments", async (req, res, next) => {
	try {
		const all = await listExperiments(req.params.id);
		const allIds = new Set(all.map((e) => e.id));
		const active = getActiveAgentExperimentIds().filter((id) => allIds.has(id));
		res.json(active);
	} catch (err) {
		next(err);
	}
});

router.post("/:id/experiments", async (req, res, next) => {
	try {
		const result = await createExperiment({ deskId: req.params.id, ...req.body });
		res.status(201).json(result);
	} catch (err) {
		next(err);
	}
});

router.get("/:id/export", async (req, res, next) => {
	try {
		const pkg = await exportDesk(req.params.id);
		const filename = `${pkg.desk.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_${new Date().toISOString().slice(0, 10)}.json`;
		res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
		res.json(pkg);
	} catch (err) {
		next(err);
	}
});

router.post("/import", async (req, res, next) => {
	try {
		const result = await importDesk(req.body);
		res.status(201).json(result);
	} catch (err) {
		next(err);
	}
});

router.post("/:id/archive", async (req, res, next) => {
	try {
		const desk = await archiveDesk(req.params.id);
		if (!desk) throw new HttpError(404, "Desk not found");
		res.json(desk);
	} catch (err) {
		next(err);
	}
});

router.get("/:id/activity", async (req, res, next) => {
	try {
		const result = await listActivity(req.params.id);
		res.json(result);
	} catch (err) {
		next(err);
	}
});

router.get("/:id/datasets", async (req, res, next) => {
	try {
		const result = await listDatasets(req.params.id);
		res.json(result);
	} catch (err) {
		next(err);
	}
});

router.post("/:id/datasets", async (req, res, next) => {
	try {
		const result = await createDataset({
			...req.body,
			createdByDeskId: req.params.id,
		});
		res.status(201).json(result);
	} catch (err) {
		next(err);
	}
});

router.get("/:id/datasets/:datasetId/preview", async (req, res, next) => {
	try {
		const limit = Number.parseInt((req.query.limit as string) ?? "50", 10);
		const preview = await previewDataset(req.params.datasetId, limit);
		if (!preview) throw new HttpError(404, "Dataset file not found");
		res.json(preview);
	} catch (err) {
		next(err);
	}
});

router.delete("/:id/datasets/:datasetId", async (req, res, next) => {
	try {
		const deleted = await deleteDataset(req.params.datasetId);
		if (!deleted) throw new HttpError(404, "Dataset not found");
		res.json(deleted);
	} catch (err) {
		next(err);
	}
});

// ── Code / Workspace routes ─────────────────────────────────────────

async function requireWorkspace(deskId: string): Promise<string> {
	const desk = await getDesk(deskId);
	if (!desk) throw new HttpError(404, "Desk not found");
	if (!desk.workspacePath) throw new HttpError(404, "Workspace not initialized");
	return desk.workspacePath;
}

router.get("/:id/code/log", async (req, res, next) => {
	try {
		const cwd = await requireWorkspace(req.params.id);
		const commits = await getLog(cwd);
		res.json(commits);
	} catch (err) {
		next(err);
	}
});

router.get("/:id/code/files", async (req, res, next) => {
	try {
		const cwd = await requireWorkspace(req.params.id);
		const commit = req.query.commit as string | undefined;
		const files = await listFiles(cwd, commit);
		res.json(files);
	} catch (err) {
		next(err);
	}
});

router.get("/:id/code/file", async (req, res, next) => {
	try {
		const cwd = await requireWorkspace(req.params.id);
		const commit = (req.query.commit as string) ?? "HEAD";
		const path = req.query.path as string;
		if (!path) throw new HttpError(400, "path query param required");
		const content = await getCode(cwd, commit, path);
		res.type("text/plain").send(content);
	} catch (err) {
		next(err);
	}
});

router.get("/:id/code/diff", async (req, res, next) => {
	try {
		const cwd = await requireWorkspace(req.params.id);
		const from = req.query.from as string;
		const to = req.query.to as string;
		if (!from || !to) throw new HttpError(400, "from and to query params required");
		const diff = await getDiff(cwd, from, to);
		res.type("text/plain").send(diff);
	} catch (err) {
		next(err);
	}
});

export default router;
