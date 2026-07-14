"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

function normalizeDate(value) {
  const digits = String(value ?? "").replaceAll("-", "");
  if (!/^\d{8}$/.test(digits)) throw new TypeError("asOfDate must use YYYYMMDD or YYYY-MM-DD.");
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function uniqueCodes(codes) {
  return [...new Set((codes ?? []).map((code) => String(code).trim()).filter(Boolean))].sort();
}

function sourceHash({ codes, selector }) {
  return crypto.createHash("sha256").update(JSON.stringify({ codes, selector })).digest("hex");
}

async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.rename(temporary, filePath);
}

async function readReusable(outputFile, hash) {
  if (!outputFile) return null;
  try {
    const payload = JSON.parse(await fs.readFile(outputFile, "utf8"));
    if (payload?.source_hash === hash && Array.isArray(payload.codes)) return payload;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return null;
}

async function buildCodeUniverse({
  asOfDate,
  codes,
  concurrency = 32,
  evaluateCode,
  force = false,
  outputFile = null,
  selector,
} = {}) {
  if (typeof evaluateCode !== "function") throw new TypeError("evaluateCode must be a function.");
  if (!selector?.id) throw new TypeError("selector.id is required.");
  const date = normalizeDate(asOfDate);
  const normalizedCodes = uniqueCodes(codes);
  const hash = sourceHash({ codes: normalizedCodes, selector });
  if (!force) {
    const reusable = await readReusable(outputFile, hash);
    if (reusable) return { ...reusable, reused: true };
  }

  const evaluations = await mapConcurrent(normalizedCodes, concurrency, async (code) => ({
    code,
    ...await evaluateCode(code, { asOfDate: date }),
  }));
  const selected = evaluations.filter((item) => item.eligible).map((item) => item.code).sort();
  const excludedByReason = {};
  for (const item of evaluations.filter((entry) => !entry.eligible)) {
    const reason = item.reason ?? "not_eligible";
    if (!excludedByReason[reason]) excludedByReason[reason] = [];
    excludedByReason[reason].push(item.code);
  }
  const payload = {
    version: 1,
    selector,
    strategy_id: selector.id,
    as_of_date: date,
    generated_at: `${date}T00:00:00.000Z`,
    source_hash: hash,
    source_code_count: normalizedCodes.length,
    total_codes: selected.length,
    excluded_counts: Object.fromEntries(Object.entries(excludedByReason).map(([reason, items]) => [reason, items.length])),
    codes: selected,
    excluded_codes: excludedByReason,
  };
  if (outputFile) await writeJson(outputFile, payload);
  return { ...payload, reused: false };
}

module.exports = {
  buildCodeUniverse,
  mapConcurrent,
  normalizeDate,
  readReusable,
  sourceHash,
  uniqueCodes,
  writeJson,
};
