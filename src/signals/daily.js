"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { normalizeDate } = require("../core/date");
const { buildFeatures, toIsoDate } = require("./features");
const { runSignals } = require("./registry");

const ROOT = path.resolve(__dirname, "../..");
const DEFAULT_POOL_TYPES = ["zt", "qs", "zb"];

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function extractKlines(payload) {
  if (Array.isArray(payload?.klines)) {
    return payload.klines;
  }
  if (Array.isArray(payload?.data?.klines)) {
    return payload.data.klines;
  }
  return [];
}

function klineFilePath(klineDir, period, code) {
  return path.join(klineDir, period, code.slice(0, 3), `${code}.json`);
}

function legacyKlineFilePath(klineDir, period, code) {
  return path.join(klineDir, period, `${code}.json`);
}

async function loadKlines(klineDir, period, code) {
  const sharded = await readJson(klineFilePath(klineDir, period, code));
  if (sharded) {
    return extractKlines(sharded);
  }
  return extractKlines(await readJson(legacyKlineFilePath(klineDir, period, code)));
}

async function loadCandidateSeeds({ date, poolDir, poolTypes = DEFAULT_POOL_TYPES }) {
  const candidates = new Map();
  for (const poolType of poolTypes) {
    const payload = await readJson(path.join(poolDir, date, `${poolType}.json`));
    const records = Array.isArray(payload?.data?.pool) ? payload.data.pool : [];
    for (const item of records) {
      const code = String(item?.c ?? "").trim();
      if (!/^\d{6}$/.test(code)) {
        continue;
      }

      if (!candidates.has(code)) {
        candidates.set(code, {
          code,
          date,
          market: item?.m ?? null,
          name: item?.n ?? "",
          pools: [],
        });
      }

      const candidate = candidates.get(code);
      if (!candidate.pools.includes(poolType)) {
        candidate.pools.push(poolType);
      }
      if (!candidate.name && item?.n) {
        candidate.name = item.n;
      }
      if (candidate.market === null && item?.m !== undefined) {
        candidate.market = item.m;
      }
    }
  }

  return [...candidates.values()].sort((left, right) => left.code.localeCompare(right.code));
}

function uniqueIssues(issues) {
  return [...new Set((issues ?? []).filter(Boolean))].sort();
}

function contextQuality(issues) {
  const unique = uniqueIssues(issues);
  return {
    issues: unique,
    status: unique.length > 0 ? "recorded" : "ok",
  };
}

async function buildSignalContext(seed, { isoDate, klineDir }) {
  const [dailyRows, yearlyRows] = await Promise.all([
    loadKlines(klineDir, "daily", seed.code),
    loadKlines(klineDir, "yearly", seed.code),
  ]);
  const built = buildFeatures({ dailyRows, isoDate, yearlyRows });
  return {
    code: seed.code,
    dailyRows: built.dailyRows,
    date: seed.date,
    features: built.features,
    isoDate,
    market: seed.market,
    name: seed.name,
    pools: seed.pools,
    quality: contextQuality(built.issues),
    yearlyRows: built.yearlyRows,
  };
}

function hitSignalIds(candidate) {
  return new Set((candidate.signals ?? []).map((signal) => signal.id));
}

function compareCandidates(left, right) {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  const leftSignals = hitSignalIds(left);
  const rightSignals = hitSignalIds(right);
  for (const signalId of ["year_breakout", "year_downtrend_reversal", "volume_expand"]) {
    const diff = Number(rightSignals.has(signalId)) - Number(leftSignals.has(signalId));
    if (diff !== 0) {
      return diff;
    }
  }

  const qualityDiff = Number(right.data_quality === "ok") - Number(left.data_quality === "ok");
  if (qualityDiff !== 0) {
    return qualityDiff;
  }
  return left.code.localeCompare(right.code);
}

function materializeCandidate(context, signalResults) {
  const signals = signalResults.filter((signal) => signal.ok);
  const quality = contextQuality([
    ...context.quality.issues,
    ...signalResults.flatMap((signal) => signal.qualityIssues ?? []),
  ]);
  const reason = signals.map((signal) => signal.id).join(", ");
  return {
    code: context.code,
    data_quality: quality.status,
    date: context.date,
    market: context.market,
    name: context.name,
    pools: context.pools,
    quality,
    rank: null,
    reason,
    score: signals.reduce((sum, signal) => sum + signal.score, 0),
    signals,
  };
}

function summarizeCandidates(candidates) {
  const issueCounts = {};
  const poolCounts = {};
  const signalCounts = {};
  for (const candidate of candidates) {
    for (const pool of candidate.pools) {
      poolCounts[pool] = (poolCounts[pool] ?? 0) + 1;
    }
    for (const signal of candidate.signals) {
      signalCounts[signal.id] = (signalCounts[signal.id] ?? 0) + 1;
    }
    for (const issue of candidate.quality.issues) {
      issueCounts[issue] = (issueCounts[issue] ?? 0) + 1;
    }
  }

  const issueCount = Object.values(issueCounts).reduce((sum, count) => sum + count, 0);
  return {
    candidate_count: candidates.length,
    issue_count: issueCount,
    issue_counts: Object.fromEntries(Object.entries(issueCounts).sort(([left], [right]) => left.localeCompare(right))),
    pool_counts: Object.fromEntries(Object.entries(poolCounts).sort(([left], [right]) => left.localeCompare(right))),
    signal_counts: Object.fromEntries(Object.entries(signalCounts).sort(([left], [right]) => left.localeCompare(right))),
    status: issueCount > 0 ? "recorded" : "ok",
  };
}

async function runDailySignals({
  date,
  klineDir = path.join(ROOT, "data", "kline"),
  poolDir = path.join(ROOT, "data", "pool"),
  registry,
} = {}) {
  const normalizedDate = normalizeDate(date);
  const isoDate = toIsoDate(normalizedDate);
  const seeds = await loadCandidateSeeds({ date: normalizedDate, poolDir });
  const candidates = [];

  for (const seed of seeds) {
    const context = await buildSignalContext(seed, { isoDate, klineDir });
    candidates.push(materializeCandidate(context, runSignals(context, registry)));
  }

  candidates.sort(compareCandidates);
  candidates.forEach((candidate, index) => {
    candidate.rank = index + 1;
  });

  return {
    candidates,
    date: normalizedDate,
    isoDate,
    summary: summarizeCandidates(candidates),
  };
}

module.exports = {
  compareCandidates,
  klineFilePath,
  legacyKlineFilePath,
  loadCandidateSeeds,
  loadKlines,
  materializeCandidate,
  runDailySignals,
  summarizeCandidates,
};
