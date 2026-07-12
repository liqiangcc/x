"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { splitSecid } = require("../../../core/secid");
const { securityKey } = require("../../core/contracts");

function compactDate(value) {
  const date = String(value ?? "").replaceAll("-", "");
  if (!/^\d{8}$/.test(date)) {
    throw new TypeError("asOfDate must use YYYYMMDD or YYYY-MM-DD.");
  }
  return date;
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    const wrapped = new Error(`Unable to read universe file: ${filePath}`);
    wrapped.code = "invalid_universe_file";
    wrapped.cause = error;
    throw wrapped;
  }
}

function normalizeCodes(values) {
  const securities = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    try {
      const security = splitSecid(value);
      securities.set(securityKey(security), {
        code: security.code,
        market: security.market,
      });
    } catch {
      // Invalid codes are excluded and reflected by the caller's coverage counts.
    }
  }
  return [...securities.values()].sort((left, right) =>
    securityKey(left).localeCompare(securityKey(right))
  );
}

async function collectJsonCodes(root) {
  const codes = new Set();

  async function walk(directory) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      const match = entry.name.match(/^(\d{6})\.json$/);
      if (match) codes.add(match[1]);
    }
  }

  await walk(root);
  return codes;
}

function result({ asOfDate, source, securities, rawCount, qualityIssues }) {
  return {
    asOfDate,
    source,
    securities,
    coverage: {
      rawCount,
      validCount: securities.length,
      excludedCount: Math.max(rawCount - securities.length, 0),
    },
    qualityIssues: [...new Set(qualityIssues)].sort(),
  };
}

class ExistingUniverseRepository {
  constructor({
    universeRoot = path.join("data", "universe"),
    poolRoot = path.join("data", "pool"),
    klineRoot = path.join("data", "kline"),
  } = {}) {
    this.universeRoot = universeRoot;
    this.poolRoot = poolRoot;
    this.klineRoot = klineRoot;
  }

  async listAvailableCodes({ asOfDate }) {
    const date = compactDate(asOfDate);
    const universePayload = await readJson(path.join(this.universeRoot, date, "codes.json"));
    if (Array.isArray(universePayload?.codes) && universePayload.codes.length > 0) {
      const securities = normalizeCodes(universePayload.codes);
      return result({
        asOfDate: date,
        source: "market_universe_snapshot",
        securities,
        rawCount: universePayload.codes.length,
        qualityIssues: ["historical_universe_unavailable", "survivorship_bias_possible"],
      });
    }

    const poolPayload = await readJson(path.join(this.poolRoot, date, "codes.json"));
    if (Array.isArray(poolPayload?.codes) && poolPayload.codes.length > 0) {
      const securities = normalizeCodes(poolPayload.codes);
      return result({
        asOfDate: date,
        source: "pool_codes_snapshot",
        securities,
        rawCount: poolPayload.codes.length,
        qualityIssues: [
          "historical_universe_unavailable",
          "pool_limited_universe",
          "survivorship_bias_possible",
        ],
      });
    }

    const [dailyCodes, yearlyCodes] = await Promise.all([
      collectJsonCodes(path.join(this.klineRoot, "daily")),
      collectJsonCodes(path.join(this.klineRoot, "yearly")),
    ]);
    const intersection = [...dailyCodes].filter((code) => yearlyCodes.has(code));
    const securities = normalizeCodes(intersection);
    return result({
      asOfDate: date,
      source: "existing_kline_universe",
      securities,
      rawCount: intersection.length,
      qualityIssues: [
        "historical_universe_unavailable",
        "kline_derived_universe",
        "survivorship_bias_possible",
      ],
    });
  }
}

module.exports = {
  ExistingUniverseRepository,
  collectJsonCodes,
  compactDate,
  normalizeCodes,
};
