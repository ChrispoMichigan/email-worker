import express from "express";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import { emailQueue } from "./queue.js";
import { insert, findByJobId, list } from "./db.js";
import { corsConfig } from "./corsConfig.js";

const app = express();
app.use(cors(corsConfig));
app.use(express.json({ limit: "20mb" }));

function resolveDelay(scheduledAt) {
  if (!scheduledAt) return { delay: 0, status: "queued" };
  const date = new Date(scheduledAt);
  if (isNaN(date.getTime()))
    throw new Error("scheduledAt debe ser una fecha ISO 8601 válida (ej: 2026-06-20T15:00:00Z)");
  const delay = date.getTime() - Date.now();
  if (delay <= 0)
    throw new Error("scheduledAt debe ser una fecha futura");
  return { delay, status: "scheduled" };
}

// POST /send — single email
app.post("/send", async (req, res) => {
  const { to, subject, template, html, variables, scheduledAt } = req.body;

  if (!to || !subject || (!html && !template)) {
    return res.status(400).json({ error: "Required: to, subject, and either html or template" });
  }

  let delay, status;
  try {
    ({ delay, status } = resolveDelay(scheduledAt));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const id = uuidv4();
  const job = await emailQueue.add(
    "send",
    { to, subject, template, html, variables, jobId: id },
    { delay }
  );

  await insert({
    id, job_id: job.id, batch_id: null,
    to_email: to, subject,
    template: template ?? "[inline]",
    scheduled_at: scheduledAt ?? null,
    status,
  });

  res.json({ jobId: id, status, scheduledAt: scheduledAt ?? null });
});

// POST /send/bulk — multiple recipients
app.post("/send/bulk", async (req, res) => {
  const { recipients, subject, template, html, scheduledAt } = req.body;

  if (!Array.isArray(recipients) || recipients.length === 0 || !subject || (!html && !template)) {
    return res.status(400).json({ error: "Required: recipients[], subject, and either html or template" });
  }

  let delay, status;
  try {
    ({ delay, status } = resolveDelay(scheduledAt));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const batchId = uuidv4();

  const jobDefs = recipients.map(({ to, variables }) => ({
    name: "send",
    data: { to, subject, template, html, variables, jobId: uuidv4() },
    opts: { delay },
  }));

  const added = await emailQueue.addBulk(jobDefs);

  await Promise.all(
    added.map((job) =>
      insert({
        id: job.data.jobId,
        job_id: job.id,
        batch_id: batchId,
        to_email: job.data.to,
        subject,
        template: template ?? "[inline]",
        scheduled_at: scheduledAt ?? null,
        status,
      })
    )
  );

  res.json({
    batchId,
    queued: added.length,
    status,
    scheduledAt: scheduledAt ?? null,
    jobIds: added.map((j) => j.data.jobId),
  });
});

// GET /jobs/:jobId
app.get("/jobs/:jobId", async (req, res) => {
  const row = await findByJobId(req.params.jobId);
  if (!row) return res.status(404).json({ error: "Job not found" });
  res.json(row);
});

// GET /time — hora actual del servidor en formato ISO 8601 UTC
app.get("/time", (_req, res) => {
  res.json({ scheduledAt: new Date().toISOString() });
});

// GET /smtp-check — prueba de conectividad al servidor SMTP (solo diagnóstico)
app.get("/smtp-check", async (_req, res) => {
  const net = await import("net");
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;

  if (!host) return res.status(500).json({ ok: false, error: "SMTP_HOST no definido" });

  const result = await new Promise((resolve) => {
    const socket = net.default.createConnection({ host, port, timeout: 8000 });
    socket.once("connect", () => { socket.destroy(); resolve({ ok: true }); });
    socket.once("timeout", () => { socket.destroy(); resolve({ ok: false, error: "Connection timeout" }); });
    socket.once("error",  (err) => resolve({ ok: false, error: err.message }));
  });

  res.json({ host, port, ...result });
});

// GET /jobs?status=&batchId=&to=&limit=&offset=
app.get("/jobs", async (req, res) => {
  const { status, batchId, to, limit, offset } = req.query;
  const result = await list({ status, batchId, to, limit, offset });
  res.json(result);
});

export default app;
