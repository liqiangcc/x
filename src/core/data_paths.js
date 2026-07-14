"use strict";

const path = require("node:path");

function dataCommitPathspecs(run) {
  const period = String(run?.period ?? "").trim();
  const runId = String(run?.run_id ?? "").trim();
  const date = String(run?.date ?? "").trim();
  const jobId = String(run?.job_id ?? "").trim();
  const paths = [];

  if (period) {
    paths.push(path.posix.join("data", "kline", period));
  }
  if (period === "daily" && Number(run?.yearly_aggregation_updated ?? 0) > 0) {
    paths.push(path.posix.join("data", "kline", "yearly"));
  }
  if (date && period && jobId) {
    paths.push(path.posix.join("data", "jobs", date, period, jobId));
  }
  if (runId) {
    paths.push(path.posix.join("runs", runId));
  }
  const strategyCodes = String(run?.artifacts?.strategy_codes ?? "").trim();
  if (strategyCodes && !path.isAbsolute(strategyCodes) && strategyCodes.startsWith("data/strategy-universe/")) {
    paths.push(strategyCodes);
  }

  return paths;
}

module.exports = {
  dataCommitPathspecs,
};
