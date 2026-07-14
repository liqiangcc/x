"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

async function walkJsonFiles(root) {
  const files = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    await Promise.all(entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && entry.name.endsWith(".json")) files.push(target);
    }));
  }
  await visit(root);
  return files.sort();
}

function latestDate(payload) {
  const rows = Array.isArray(payload?.klines) ? payload.klines : payload?.data?.klines;
  if (!Array.isArray(rows)) return null;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const date = typeof rows[index] === "string" ? rows[index].split(",")[0] : null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) return date;
  }
  return null;
}

async function mapConcurrent(items, concurrency, worker) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) await worker(items[cursor++]);
  }));
}

async function latestDateFromFile(filePath, tailBytes = 4096) {
  const file = await fs.open(filePath, "r");
  try {
    const stat = await file.stat();
    const length = Math.min(tailBytes, stat.size);
    const buffer = Buffer.alloc(length);
    await file.read(buffer, 0, length, stat.size - length);
    const matches = buffer.toString("utf8").match(/\d{4}-\d{2}-\d{2}/g);
    return matches?.at(-1) ?? null;
  } finally {
    await file.close();
  }
}

async function inspectPeriod(root, period) {
  const files = (await walkJsonFiles(path.join(root, period)))
    .filter((filePath) => /^\d{6}\.json$/.test(path.basename(filePath)));
  const distribution = new Map();
  let emptyCount = 0;
  let invalidCount = 0;
  await mapConcurrent(files, 64, async (filePath) => {
    try {
      const date = await latestDateFromFile(filePath);
      if (!date) {
        emptyCount += 1;
        return;
      }
      distribution.set(date, (distribution.get(date) ?? 0) + 1);
    } catch {
      invalidCount += 1;
    }
  });
  const recentDates = [...distribution.entries()].sort(([left], [right]) => right.localeCompare(left));
  return {
    period,
    codeCount: files.length,
    readableCount: files.length - invalidCount,
    invalidCount,
    emptyCount,
    latestDate: recentDates[0]?.[0] ?? null,
    latestDateCodeCount: recentDates[0]?.[1] ?? 0,
    recentDateDistribution: recentDates.slice(0, 5).map(([date, count]) => ({ count, date })),
  };
}

async function latestStrategyUniverse(strategyRoot) {
  const files = (await walkJsonFiles(strategyRoot)).filter((filePath) => path.basename(filePath) === "codes.json");
  const payloads = [];
  for (const filePath of files) {
    try {
      const payload = JSON.parse(await fs.readFile(filePath, "utf8"));
      if (payload?.strategy_id && Array.isArray(payload.codes)) payloads.push({ ...payload, filePath });
    } catch {}
  }
  payloads.sort((left, right) => String(right.as_of_date ?? "").localeCompare(String(left.as_of_date ?? "")));
  const latest = payloads[0];
  if (!latest) return null;
  return {
    strategyId: latest.strategy_id,
    asOfDate: latest.as_of_date,
    targetYear: latest.target_year ?? latest.selector?.targetYear,
    sourceCodeCount: latest.source_code_count,
    codeCount: latest.total_codes,
    missingYearlyCount: latest.missing_yearly_count ?? latest.excluded_counts?.missing_yearly ?? 0,
    generatedAt: latest.generated_at,
    codes: latest.codes,
  };
}

async function buildDataStatus({
  klineRoot = path.join("data", "kline"),
  strategyRoot = path.join("data", "strategy-universe"),
} = {}) {
  const [daily, yearly, strategyUniverse] = await Promise.all([
    inspectPeriod(klineRoot, "daily"),
    inspectPeriod(klineRoot, "yearly"),
    latestStrategyUniverse(strategyRoot),
  ]);
  return { generatedAt: new Date().toISOString(), periods: { daily, yearly }, strategyUniverse };
}

class DataStatusService {
  constructor({ cacheTtlMs = 300000, ...paths } = {}) {
    this.cacheTtlMs = cacheTtlMs;
    this.paths = paths;
    this.cached = null;
    this.inFlight = null;
  }

  async get({ refresh = false } = {}) {
    if (!refresh && this.cached && Date.now() - this.cached.cachedAt < this.cacheTtlMs) return this.cached.value;
    if (this.inFlight) return this.inFlight;
    this.inFlight = buildDataStatus(this.paths).then((value) => {
      this.cached = { cachedAt: Date.now(), value };
      return value;
    }).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  invalidate() {
    this.cached = null;
  }
}

module.exports = {
  DataStatusService,
  buildDataStatus,
  inspectPeriod,
  latestDate,
  latestDateFromFile,
  latestStrategyUniverse,
  walkJsonFiles,
};
