#!/usr/bin/env node

"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { normalizeDate } = require("../src/core/date");

const ROOT = path.resolve(__dirname, "..");
const ISSUE_LABELS = {
  "daily-report": { color: "0e8a16", description: "Daily candidate report review." },
  "needs-review": { color: "fbca04", description: "Needs human review." },
  report: { color: "1d76db", description: "Generated report artifact." },
};

function valueOrDefault(value, fallback) {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function sanitizeBranchSegment(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=,@+-]+$/.test(text)) {
    return text;
  }
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function actionRunUrl(env = process.env) {
  if (!env.GITHUB_REPOSITORY || !env.GITHUB_RUN_ID) {
    return null;
  }
  const serverUrl = String(env.GITHUB_SERVER_URL || "https://github.com").replace(/\/$/, "");
  return `${serverUrl}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
}

function normalizeOptions(env = process.env) {
  const date = normalizeDate(valueOrDefault(env.DATE_INPUT, env.date));
  return {
    baseRef: valueOrDefault(env.BASE_REF_INPUT, "master"),
    commitReport: !["0", "false", "no", "off"].includes(String(env.COMMIT_REPORT_INPUT ?? "true").toLowerCase()),
    dataRef: valueOrDefault(env.DATA_REF_INPUT, env.GITHUB_REF_NAME || "master"),
    date,
    openIssue: !["0", "false", "no", "off"].includes(String(env.OPEN_ISSUE_INPUT ?? "true").toLowerCase()),
  };
}

function reportBranchName(date) {
  return `report/daily/${sanitizeBranchSegment(date)}`;
}

function reportPullRequestTitle(date) {
  return `report(daily): ${date} candidate report`;
}

function formatCounts(counts) {
  const entries = Object.entries(counts ?? {}).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    return "none";
  }
  return entries.map(([key, value]) => `${key}: ${value}`).join(", ");
}

function markdownCell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replace(/\r?\n/g, " ");
}

function topCandidateRows(candidates, limit = 20) {
  return (candidates ?? []).slice(0, limit).map((candidate) => ({
    code: candidate.code,
    name: candidate.name,
    pools: Array.isArray(candidate.pools) ? candidate.pools.join("|") : "",
    quality: candidate.data_quality,
    rank: candidate.rank,
    score: candidate.score,
    signals: Array.isArray(candidate.signals)
      ? candidate.signals.map((signal) => signal.id).join("|")
      : "",
  }));
}

function renderCandidateTable(candidates) {
  const rows = topCandidateRows(candidates);
  if (rows.length === 0) {
    return "No candidates.";
  }
  return [
    "| rank | code | name | score | pools | signals | quality |",
    "|---:|---|---|---:|---|---|---|",
    ...rows.map((row) =>
      `| ${row.rank} | ${markdownCell(row.code)} | ${markdownCell(row.name)} | ${row.score} | ${markdownCell(row.pools)} | ${markdownCell(row.signals)} | ${markdownCell(row.quality)} |`
    ),
  ].join("\n");
}

function reportPullRequestBody({ branchName, dataRef, report }) {
  return [
    "## Daily report",
    "",
    `- date: ${report.date}`,
    `- data_ref: ${dataRef}`,
    `- branch: ${branchName}`,
    `- candidates: ${report.summary?.candidate_count ?? report.candidates.length}`,
    `- quality: ${report.quality?.status ?? report.summary?.status ?? "n/a"}`,
    `- issues: ${formatCounts(report.quality?.issue_counts ?? report.summary?.issue_counts)}`,
    "",
    "## Artifacts",
    "",
    `- reports/${report.date}/summary.md`,
    `- reports/${report.date}/candidates.csv`,
    `- reports/${report.date}/candidates.json`,
    `- reports/${report.date}/quality.json`,
    "",
  ].join("\n");
}

function buildReportIssueTitle(date) {
  return `Daily report ${date}`;
}

function buildReportIssueBody({ dataRef, report, reportPullRequest = null, reportPullRequestError = null, env = process.env }) {
  return [
    "## Daily report",
    "",
    `- date: ${report.date}`,
    `- data_ref: ${dataRef}`,
    `- quality: ${report.quality?.status ?? report.summary?.status ?? "n/a"}`,
    `- candidates: ${report.summary?.candidate_count ?? report.candidates.length}`,
    `- issues: ${formatCounts(report.quality?.issue_counts ?? report.summary?.issue_counts)}`,
    `- report_pr: ${reportPullRequest?.url ?? "n/a"}`,
    `- report_pr_state: ${reportPullRequest?.state ?? "n/a"}`,
    `- report_pr_error: ${reportPullRequestError?.message ?? "n/a"}`,
    `- action_run: ${actionRunUrl(env) ?? "n/a"}`,
    "",
    "## Artifacts",
    "",
    `- reports/${report.date}/summary.md`,
    `- reports/${report.date}/candidates.csv`,
    `- reports/${report.date}/candidates.json`,
    `- reports/${report.date}/quality.json`,
    "",
    "## Top candidates",
    "",
    renderCandidateTable(report.candidates),
    "",
    "## Rerun",
    "",
    "```bash",
    `bin/x report daily --date ${report.date}`,
    "```",
    "",
  ].join("\n");
}

function buildIssueSearchArgs(title) {
  return [
    "issue",
    "list",
    "--state",
    "all",
    "--limit",
    "20",
    "--search",
    `in:title "${title}"`,
    "--json",
    "number,title,state,url",
  ];
}

function selectReportIssue(issues, title) {
  if (!Array.isArray(issues)) {
    return null;
  }
  return issues.find((issue) => issue.title === title && issue.state === "OPEN") ??
    issues.find((issue) => issue.title === title) ??
    null;
}

function selectReportPullRequest(pullRequests) {
  if (!Array.isArray(pullRequests) || pullRequests.length === 0) {
    return null;
  }
  return pullRequests.find((pr) => pr.state === "OPEN") ??
    pullRequests.find((pr) => pr.state === "MERGED") ??
    pullRequests[0];
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? ROOT,
      env: options.env ?? process.env,
      stdio: options.stdio ?? "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

function runCapture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? ROOT,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stderr, stdout }));
  });
}

async function runChecked(command, args, options = {}) {
  const code = await run(command, args, options);
  if (code !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${code}`);
  }
}

async function runCaptureChecked(command, args, options = {}) {
  const result = await runCapture(command, args, options);
  if (result.code !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.code}: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function loadReport(date, reportsDir = path.join(ROOT, "reports")) {
  const reportDir = path.join(reportsDir, date);
  const candidatesPayload = await readJson(path.join(reportDir, "candidates.json"));
  const quality = await readJson(path.join(reportDir, "quality.json"));
  return {
    candidates: candidatesPayload.candidates ?? [],
    date,
    quality,
    reportDir,
    summary: candidatesPayload.summary ?? {},
  };
}

async function hasStagedChanges() {
  const result = await runCapture("git", ["diff", "--cached", "--quiet"]);
  if (result.code === 0) {
    return false;
  }
  if (result.code === 1) {
    return true;
  }
  throw new Error(result.stderr || "git diff --cached --quiet failed");
}

async function createOrUpdateReportPullRequest({ baseRef, dataRef, report }) {
  const branchName = reportBranchName(report.date);
  const sourceDir = report.reportDir;
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "x-report-pr-"));
  const tmpReportDir = path.join(tmpRoot, report.date);
  await fs.cp(sourceDir, tmpReportDir, { recursive: true });

  try {
    await runChecked("git", ["fetch", "origin", baseRef]);
    await runChecked("git", ["checkout", "-B", branchName, `origin/${baseRef}`]);
    const targetDir = path.join(ROOT, "reports", report.date);
    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.mkdir(path.dirname(targetDir), { recursive: true });
    await fs.cp(tmpReportDir, targetDir, { recursive: true });
    await runChecked("git", ["add", "--", path.posix.join("reports", report.date)]);

    let committed = false;
    let commit = null;
    if (await hasStagedChanges()) {
      await runChecked("git", ["commit", "-m", reportPullRequestTitle(report.date)]);
      committed = true;
      commit = (await runCaptureChecked("git", ["rev-parse", "--short", "HEAD"])).trim();
      await runChecked("git", ["push", "--set-upstream", "origin", `HEAD:${branchName}`]);
    }

    const existing = await runCaptureChecked("gh", [
      "pr",
      "list",
      "--head",
      branchName,
      "--base",
      baseRef,
      "--state",
      "all",
      "--json",
      "number,url,state,mergedAt,headRefOid",
    ]);
    const selected = selectReportPullRequest(JSON.parse(existing));
    if (selected) {
      return { branchName, commit, committed, pr: selected };
    }
    if (!committed) {
      return { branchName, commit, committed, pr: null };
    }

    const stdout = await runCaptureChecked("gh", [
      "pr",
      "create",
      "--base",
      baseRef,
      "--head",
      branchName,
      "--title",
      reportPullRequestTitle(report.date),
      "--body",
      reportPullRequestBody({ branchName, dataRef, report }),
    ]);
    const url = stdout.trim();
    const match = url.match(/\/pull\/(\d+)/);
    return {
      branchName,
      commit,
      committed,
      pr: {
        number: match ? Number(match[1]) : null,
        state: "OPEN",
        url,
      },
    };
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
}

async function ensureIssueLabels() {
  for (const [name, label] of Object.entries(ISSUE_LABELS)) {
    await runCaptureChecked("gh", [
      "label",
      "create",
      name,
      "--color",
      label.color,
      "--description",
      label.description,
      "--force",
    ]);
  }
}

async function syncReportIssue({ dataRef, report, reportPullRequest = null, reportPullRequestError = null, env = process.env }) {
  if (!isTruthy(env.GITHUB_ACTIONS) || !isTruthy(env.OPEN_ISSUE_INPUT ?? "true")) {
    return null;
  }

  await ensureIssueLabels();
  const title = buildReportIssueTitle(report.date);
  const stdout = await runCaptureChecked("gh", buildIssueSearchArgs(title));
  const issue = selectReportIssue(JSON.parse(stdout), title);
  const body = buildReportIssueBody({ dataRef, env, report, reportPullRequest, reportPullRequestError });
  const labels = ["daily-report", "report", "needs-review"];

  if (issue?.state === "OPEN") {
    await runCaptureChecked("gh", ["issue", "edit", String(issue.number), "--body", body, "--add-label", labels.join(",")]);
    return { issue, issueCreated: false, skippedClosed: false };
  }
  if (issue?.state === "CLOSED") {
    return { issue, issueCreated: false, skippedClosed: true };
  }

  const createArgs = ["issue", "create", "--title", title, "--body", body];
  for (const label of labels) {
    createArgs.push("--label", label);
  }
  const created = await runCaptureChecked("gh", createArgs);
  const match = created.match(/\/issues\/(\d+)/);
  return {
    issue: {
      number: match ? Number(match[1]) : null,
      state: "OPEN",
      title,
      url: created.trim(),
    },
    issueCreated: true,
    skippedClosed: false,
  };
}

async function writeStepSummary({ report, reportPullRequest = null }) {
  if (!process.env.GITHUB_STEP_SUMMARY) {
    return;
  }
  await fs.appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    [
      "## Daily report",
      "",
      `- date: ${report.date}`,
      `- candidates: ${report.summary?.candidate_count ?? report.candidates.length}`,
      `- quality: ${report.quality?.status ?? report.summary?.status ?? "n/a"}`,
      `- issues: ${formatCounts(report.quality?.issue_counts ?? report.summary?.issue_counts)}`,
      `- report_pr: ${reportPullRequest?.url ?? "n/a"}`,
      "",
      renderCandidateTable(report.candidates),
      "",
    ].join("\n"),
    "utf8"
  );
}

async function main() {
  const options = normalizeOptions();
  await runChecked(process.execPath, [path.join(ROOT, "bin/x"), "report", "daily", "--date", options.date]);
  const report = await loadReport(options.date);

  let reportPullRequest = null;
  let reportPullRequestError = null;
  if (options.commitReport) {
    try {
      const setup = await createOrUpdateReportPullRequest({
        baseRef: options.baseRef,
        dataRef: options.dataRef,
        report,
      });
      reportPullRequest = setup.pr;
      if (reportPullRequest?.url) {
        console.log(`Report pull request: ${reportPullRequest.url}`);
      }
    } catch (error) {
      reportPullRequestError = error;
      console.error(`Report PR sync failed: ${error.message}`);
    }
  }

  if (options.openIssue) {
    try {
      await syncReportIssue({
        dataRef: options.dataRef,
        env: { ...process.env, OPEN_ISSUE_INPUT: String(options.openIssue) },
        report,
        reportPullRequest,
        reportPullRequestError,
      });
    } catch (error) {
      console.error(`Report issue sync failed: ${error.message}`);
    }
  }

  await writeStepSummary({ report, reportPullRequest });

  if (reportPullRequestError) {
    throw reportPullRequestError;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  buildIssueSearchArgs,
  buildReportIssueBody,
  buildReportIssueTitle,
  normalizeOptions,
  renderCandidateTable,
  reportBranchName,
  reportPullRequestBody,
  reportPullRequestTitle,
  selectReportIssue,
  selectReportPullRequest,
  topCandidateRows,
};
