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
  if (date && period && jobId) {
    paths.push(path.posix.join("data", "jobs", date, period, jobId));
  }
  if (runId) {
    paths.push(path.posix.join("runs", runId));
  }

  return paths;
}

module.exports = {
  dataCommitPathspecs,
};
