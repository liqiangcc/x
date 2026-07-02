"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { runDailySignals } = require("../signals/daily");

const ROOT = path.resolve(__dirname, "../..");
const CSV_COLUMNS = ["rank", "date", "code", "name", "market", "score", "pools", "signals", "data_quality", "reason"];

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function candidateCsvValue(candidate, column) {
  if (column === "pools") {
    return candidate.pools.join("|");
  }
  if (column === "signals") {
    return candidate.signals.map((signal) => signal.id).join("|");
  }
  return candidate[column];
}

function candidatesToCsv(candidates) {
  const rows = candidates.map((candidate) =>
    CSV_COLUMNS.map((column) => csvEscape(candidateCsvValue(candidate, column))).join(",")
  );
  return `${CSV_COLUMNS.join(",")}\n${rows.join("\n")}\n`;
}

function formatCounts(counts) {
  const entries = Object.entries(counts ?? {});
  if (entries.length === 0) {
    return "none";
  }
  return entries.map(([key, value]) => `${key}: ${value}`).join(", ");
}

function renderMarkdownTable(candidates) {
  const lines = [
    "| rank | code | name | score | pools | signals | quality |",
    "|---:|---|---|---:|---|---|---|",
  ];
  for (const candidate of candidates.slice(0, 20)) {
    lines.push([
      `| ${candidate.rank}`,
      candidate.code,
      candidate.name,
      String(candidate.score),
      candidate.pools.join("|"),
      candidate.signals.map((signal) => signal.id).join("|"),
      `${candidate.data_quality} |`,
    ].join(" | "));
  }
  return lines.join("\n");
}

function renderSummaryMarkdown(report) {
  return [
    `# ${report.date} Daily Candidates`,
    "",
    `- candidates: ${report.summary.candidate_count}`,
    `- quality: ${report.summary.status}`,
    `- pools: ${formatCounts(report.summary.pool_counts)}`,
    `- signals: ${formatCounts(report.summary.signal_counts)}`,
    `- issues: ${formatCounts(report.summary.issue_counts)}`,
    "",
    renderMarkdownTable(report.candidates),
    "",
  ].join("\n");
}

async function writeDailyReport({
  candidates,
  date,
  isoDate,
  outputDir = path.join(ROOT, "reports"),
  summary,
}) {
  const report = {
    candidates,
    date,
    isoDate,
    summary,
  };
  const reportDir = path.join(outputDir, date);
  const quality = {
    date,
    issue_count: summary.issue_count,
    issue_counts: summary.issue_counts,
    candidate_count: summary.candidate_count,
    status: summary.status,
  };

  await fs.mkdir(reportDir, { recursive: true });
  await writeJson(path.join(reportDir, "candidates.json"), report);
  await fs.writeFile(path.join(reportDir, "candidates.csv"), candidatesToCsv(candidates), "utf8");
  await writeJson(path.join(reportDir, "quality.json"), quality);
  await fs.writeFile(path.join(reportDir, "summary.md"), renderSummaryMarkdown(report), "utf8");

  return {
    candidates,
    quality,
    reportDir,
    summary,
  };
}

async function generateDailyReport({
  date,
  klineDir = path.join(ROOT, "data", "kline"),
  outputDir = path.join(ROOT, "reports"),
  poolDir = path.join(ROOT, "data", "pool"),
} = {}) {
  const signalReport = await runDailySignals({ date, klineDir, poolDir });
  return writeDailyReport({
    ...signalReport,
    outputDir,
  });
}

module.exports = {
  candidatesToCsv,
  generateDailyReport,
  renderSummaryMarkdown,
  writeDailyReport,
};
