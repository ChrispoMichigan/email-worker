import express from "express";
import { v4 as uuidv4 } from "uuid";
import { emailQueue } from "./queue.js";
import { insert, findByJobId, list } from "./db.js";

const app = express();
app.use(express.json({ limit: "20mb" }));

// POST /send — single email
app.post("/send", async (req, res) => {
  const { to, subject, template, html, variables } = req.body;

  if (!to || !subject || (!html && !template)) {
    return res.status(400).json({ error: "Required: to, subject, and either html or template" });
  }

  const id = uuidv4();
  const job = await emailQueue.add("send", { to, subject, template, html, variables, jobId: id });

  await insert({ id, job_id: job.id, batch_id: null, to_email: to, subject, template: template ?? "[inline]" });

  res.json({ jobId: id, status: "queued" });
});

// POST /send/bulk — multiple recipients
app.post("/send/bulk", async (req, res) => {
  const { recipients, subject, template, html } = req.body;

  if (!Array.isArray(recipients) || recipients.length === 0 || !subject || (!html && !template)) {
    return res.status(400).json({ error: "Required: recipients[], subject, and either html or template" });
  }

  const batchId = uuidv4();

  const jobDefs = recipients.map(({ to, variables }) => ({
    name: "send",
    data: { to, subject, template, html, variables, jobId: uuidv4() },
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
      })
    )
  );

  res.json({
    batchId,
    queued: added.length,
    jobIds: added.map((j) => j.data.jobId),
  });
});

// GET /jobs/:jobId
app.get("/jobs/:jobId", async (req, res) => {
  const row = await findByJobId(req.params.jobId);
  if (!row) return res.status(404).json({ error: "Job not found" });
  res.json(row);
});

// GET /jobs?status=&batchId=&to=&limit=&offset=
app.get("/jobs", async (req, res) => {
  const { status, batchId, to, limit, offset } = req.query;
  const result = await list({ status, batchId, to, limit, offset });
  res.json(result);
});

export default app;
