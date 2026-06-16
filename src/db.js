import { connection } from "./queue.js";

const KEY_JOB    = (id)     => `email:job:${id}`;
const KEY_ALL    = ()       => `email:idx:all`;
const KEY_STATUS = (status) => `email:idx:status:${status}`;
const KEY_BATCH  = (id)     => `email:idx:batch:${id}`;

const TTL = 7 * 24 * 60 * 60; // 7 días en segundos

export async function insert({
  id, job_id, batch_id, to_email, subject, template,
  scheduled_at = null,
  status = "queued",
}) {
  const now = new Date().toISOString();
  const score = Date.now();
  const pipe = connection.pipeline();

  pipe.hset(KEY_JOB(id), {
    id, job_id, batch_id: batch_id ?? "", to_email, subject, template,
    status, scheduled_at: scheduled_at ?? "",
    error: "", created_at: now, updated_at: now,
  });

  pipe.expire(KEY_JOB(id), TTL);
  pipe.zadd(KEY_ALL(), score, id);
  pipe.zadd(KEY_STATUS(status), score, id);

  if (batch_id) {
    pipe.sadd(KEY_BATCH(batch_id), id);
    pipe.expire(KEY_BATCH(batch_id), TTL);
  }

  await pipe.exec();
}

export async function updateStatus(jobId, status, error = "") {
  const now = new Date().toISOString();
  const row = await connection.hgetall(KEY_JOB(jobId));
  if (!row?.id) return;

  const pipe = connection.pipeline();
  pipe.hset(KEY_JOB(jobId), { status, error: error ?? "", updated_at: now });
  pipe.zrem(KEY_STATUS(row.status), jobId);
  pipe.zadd(KEY_STATUS(status), Date.now(), jobId);
  await pipe.exec();
}

export async function findByJobId(jobId) {
  const row = await connection.hgetall(KEY_JOB(jobId));
  return row && row.id ? row : null;
}

export async function list({ status, batchId, to, limit = 50, offset = 0 } = {}) {
  const lim = Number(limit);
  const off = Number(offset);
  let ids;

  if (batchId) {
    ids = await connection.smembers(KEY_BATCH(batchId));
  } else if (status) {
    ids = await connection.zrange(KEY_STATUS(status), "+inf", "-inf", "BYSCORE", "REV", "LIMIT", off, lim + 1);
  } else {
    ids = await connection.zrange(KEY_ALL(), "+inf", "-inf", "BYSCORE", "REV", "LIMIT", off, lim + 1);
  }

  const total = ids.length;
  const page  = batchId ? ids.slice(off, off + lim) : ids.slice(0, lim);

  const rows = await Promise.all(page.map((id) => connection.hgetall(KEY_JOB(id))));
  const filtered = to
    ? rows.filter((r) => r?.to_email?.includes(to))
    : rows.filter(Boolean);

  return { rows: filtered, total };
}
