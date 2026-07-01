"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

function marketUniverseRootForRun({ date, jobId = null, jobMode = "single", period = "daily", runId = null }, {
  jobsDir = path.join("data", "jobs"),
  runsDir = "runs",
} = {}) {
  if (jobMode === "batch") {
    if (!date || !period || !jobId) {
      throw new Error("Batch market universe requires date, period, and jobId.");
    }
    return path.join(jobsDir, date, period, jobId, "universe");
  }

  if (!runId) {
    throw new Error("Single-run market universe requires runId.");
  }
  return path.join(runsDir, runId, "universe");
}

async function hasCompleteMarketUniverse(date, outputDir, market = "hs-a") {
  const universeDir = path.join(outputDir, date);
  try {
    const codesPayload = JSON.parse(await fs.readFile(path.join(universeDir, "codes.json"), "utf8"));
    const stocksPayload = JSON.parse(await fs.readFile(path.join(universeDir, "stocks.json"), "utf8"));
    return (
      codesPayload.date === date &&
      stocksPayload.date === date &&
      codesPayload.market === market &&
      stocksPayload.market === market &&
      Array.isArray(codesPayload.codes) &&
      Array.isArray(stocksPayload.stocks) &&
      codesPayload.codes.length > 0 &&
      codesPayload.codes.length === stocksPayload.stocks.length &&
      stocksPayload.stocks.every((stock) => typeof stock?.quote_available === "boolean")
    );
  } catch {
    return false;
  }
}

function shouldReuseMarketUniverse({ complete, forceUniverse = false }) {
  return Boolean(complete) && !forceUniverse;
}

async function copyMarketUniverseSnapshot(date, sourceRoot, targetRoot) {
  const sourceDateDir = path.join(sourceRoot, date);
  const targetDateDir = path.join(targetRoot, date);
  await fs.rm(targetDateDir, { recursive: true, force: true });
  await fs.mkdir(targetRoot, { recursive: true });
  await fs.cp(sourceDateDir, targetDateDir, { recursive: true });

  const sourceSummaryPath = path.join(sourceRoot, "summary.json");
  const targetSummaryPath = path.join(targetRoot, "summary.json");
  try {
    const summary = JSON.parse(await fs.readFile(sourceSummaryPath, "utf8"));
    if (summary?.date === date) {
      await fs.writeFile(targetSummaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  return targetDateDir;
}

module.exports = {
  copyMarketUniverseSnapshot,
  hasCompleteMarketUniverse,
  marketUniverseRootForRun,
  shouldReuseMarketUniverse,
};
