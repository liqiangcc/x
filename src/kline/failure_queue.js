"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

function retryDelayMs(errorClass) {
  if (["forbidden", "rate_limited"].includes(errorClass)) return 2 * 60 * 60 * 1000;
  if (["tls_error", "invalid_payload", "empty_klines", "blank_klines"].includes(errorClass)) return 24 * 60 * 60 * 1000;
  return 30 * 60 * 1000;
}

async function readQueue(file) {
  try {
    const payload = JSON.parse(await fs.readFile(file, "utf8"));
    return { version: 1, period: payload.period ?? null, expected_latest_date: payload.expected_latest_date ?? null, items: Array.isArray(payload.items) ? payload.items : [] };
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, period: null, items: [] };
    throw error;
  }
}

async function atomicWrite(file, payload) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.rename(temp, file);
}

function queuePayload(period, items, expectedLatestDate = null) {
  const sorted = [...items].sort((left, right) => left.code.localeCompare(right.code));
  return { version: 1, period, expected_latest_date: expectedLatestDate, updated_at: new Date().toISOString(), total_codes: sorted.length, codes: sorted.map((item) => item.code), items: sorted };
}

async function updateFailureQueue({ deadLetterFile, expectedLatestDate, maxAttempts = 3, period, queueFile, results }) {
  const queue = await readQueue(queueFile);
  const dead = await readQueue(deadLetterFile);
  const activeByCode = new Map(queue.items.map((item) => [item.code, item]));
  const deadByCode = new Map(dead.items.map((item) => [item.code, item]));
  const now = new Date();
  for (const [code, result] of Object.entries(results ?? {})) {
    if (["success", "skipped_existing", "migrated_existing"].includes(result.status)) {
      activeByCode.delete(code);
      continue;
    }
    if (result.status !== "failed") continue;
    const previous = activeByCode.get(code);
    const attempts = Number(previous?.attempts ?? 0) + 1;
    const item = {
      code,
      period,
      attempts,
      error: result.error ?? null,
      error_class: result.error_class ?? "unknown",
      first_failed_at: previous?.first_failed_at ?? now.toISOString(),
      last_failed_at: now.toISOString(),
      last_proxy_id: result.proxy_id ?? null,
      next_retry_at: new Date(now.getTime() + retryDelayMs(result.error_class)).toISOString(),
    };
    if (attempts >= maxAttempts) {
      activeByCode.delete(code);
      deadByCode.set(code, item);
    } else activeByCode.set(code, item);
  }
  const activePayload = queuePayload(period, [...activeByCode.values()], expectedLatestDate ?? queue.expected_latest_date);
  const deadPayload = queuePayload(period, [...deadByCode.values()], expectedLatestDate ?? dead.expected_latest_date);
  await atomicWrite(queueFile, activePayload);
  await atomicWrite(deadLetterFile, deadPayload);
  return { active: activePayload, dead: deadPayload };
}

async function writeDueCodes(queueFile, outputFile, now = new Date()) {
  const queue = await readQueue(queueFile);
  const codes = queue.items.filter((item) => Date.parse(item.next_retry_at ?? 0) <= now.getTime()).map((item) => item.code).sort();
  await atomicWrite(outputFile, { period: queue.period, expected_latest_date: queue.expected_latest_date, total_codes: codes.length, codes });
  return { period: queue.period, expectedLatestDate: queue.expected_latest_date, codes, outputFile };
}

module.exports = { atomicWrite, readQueue, retryDelayMs, updateFailureQueue, writeDueCodes };
