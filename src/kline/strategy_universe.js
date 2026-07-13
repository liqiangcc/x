"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { splitSecid } = require("../core/secid");
const { ExistingKlineRepository } = require("../simulator/adapters/ledger/existing_kline_repository");
const { hasEligibleYear, mapConcurrent } = require("../simulator/selection/pipeline");

const STRATEGY_ID = "year-decline-close-breakout";

function normalizeDate(value) {
  const digits = String(value ?? "").replaceAll("-", "");
  if (!/^\d{8}$/.test(digits)) throw new TypeError("asOfDate must use YYYYMMDD or YYYY-MM-DD.");
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function uniqueCodes(codes) {
  return [...new Set((codes ?? []).map((code) => String(code).trim()).filter(Boolean))].sort();
}

function sourceHash({ codes, downTransitions, targetYear }) {
  return crypto.createHash("sha256")
    .update(JSON.stringify({ codes, downTransitions, strategyId: STRATEGY_ID, targetYear }))
    .digest("hex");
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

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function buildStrategyUniverse({
  asOfDate,
  codes,
  concurrency = 32,
  downTransitions = 3,
  force = false,
  klineRoot = path.join("data", "kline"),
  outputFile = null,
} = {}) {
  const date = normalizeDate(asOfDate);
  const targetYear = Number(date.slice(0, 4));
  const normalizedCodes = uniqueCodes(codes);
  const hash = sourceHash({ codes: normalizedCodes, downTransitions, targetYear });
  if (!force) {
    const reusable = await readReusable(outputFile, hash);
    if (reusable) return { ...reusable, reused: true };
  }

  const repository = new ExistingKlineRepository({ cacheSize: Math.max(256, concurrency * 2), klineRoot });
  const eligibleCodes = [];
  const invalidCodes = [];
  const missingYearlyCodes = [];
  await mapConcurrent(normalizedCodes, concurrency, async (inputCode) => {
    let security;
    try {
      security = splitSecid(inputCode);
    } catch {
      invalidCodes.push(inputCode);
      return;
    }
    const history = await repository.getLegacyHistory({
      ...security,
      endDate: `${targetYear - 1}-12-31`,
      period: "yearly",
    });
    if (history.bars.length === 0) {
      missingYearlyCodes.push(security.code);
      return;
    }
    if (hasEligibleYear(history.bars, [targetYear], downTransitions)) eligibleCodes.push(security.code);
  });

  const payload = {
    version: 1,
    strategy_id: STRATEGY_ID,
    as_of_date: date,
    target_year: targetYear,
    down_transitions: downTransitions,
    required_completed_years: downTransitions + 1,
    generated_at: `${date}T00:00:00.000Z`,
    source_hash: hash,
    source_code_count: normalizedCodes.length,
    total_codes: eligibleCodes.length,
    missing_yearly_count: missingYearlyCodes.length,
    invalid_code_count: invalidCodes.length,
    codes: eligibleCodes.sort(),
    missing_yearly_codes: missingYearlyCodes.sort(),
    invalid_codes: invalidCodes.sort(),
    todo: missingYearlyCodes.length > 0
      ? "Backfill yearly history separately; missing codes are intentionally excluded from today's strategy sync."
      : null,
  };
  if (outputFile) await writeJson(outputFile, payload);
  return { ...payload, reused: false };
}

module.exports = {
  STRATEGY_ID,
  buildStrategyUniverse,
  normalizeDate,
  sourceHash,
  uniqueCodes,
};
