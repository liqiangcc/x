#!/usr/bin/env node

"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const ISSUE_LABELS = {
  blocked: { color: "d73a49", description: "Daily sync job is blocked." },
  completed: { color: "0e8a16", description: "Daily sync job completed." },
  "daily-sync": { color: "0366d6", description: "Daily data sync tracking issue." },
  failed: { color: "b60205", description: "Daily sync job failed." },
  kline: { color: "5319e7", description: "Kline data workflow." },
  running: { color: "fbca04", description: "Daily sync job is running." },
};
const STATUS_LABELS = ["running", "blocked", "completed", "failed"];

function valueOrDefault(value, fallback) {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function isRemoteKlineEngine(engine) {
  return engine === "auto" || engine === "aws" || engine === "aws-router" || engine === "huaweicloud";
}

function buildDailyArgs(env = process.env) {
  const period = valueOrDefault(env.PERIOD_INPUT, "daily");
  const limit = String(env.LIMIT_INPUT ?? "").trim();
  const engine = valueOrDefault(env.ENGINE_INPUT, "aws-router");
  const universe = valueOrDefault(env.UNIVERSE_INPUT, "market");
  const jobMode = valueOrDefault(env.JOB_MODE_INPUT, "batch");
  const concurrency = valueOrDefault(env.CONCURRENCY_INPUT, "4");
  const retryAttempts = valueOrDefault(
    env.RETRY_ATTEMPTS_INPUT,
    isRemoteKlineEngine(engine) ? (period === "yearly" ? "5" : "3") : "0"
  );
  const retryConcurrency = valueOrDefault(env.RETRY_CONCURRENCY_INPUT, "1");
  const batchSize = valueOrDefault(env.BATCH_SIZE_INPUT, "300");
  const minSuccessRate = valueOrDefault(env.MIN_SUCCESS_RATE_INPUT, "0.95");
  const date = String(env.DATE_INPUT ?? "").trim();
  const jobId = String(env.JOB_ID_INPUT ?? "").trim();
  const chainDepth = String(env.CHAIN_DEPTH_INPUT ?? "").trim();
  const maxChainDepth = String(env.MAX_CHAIN_DEPTH_INPUT ?? "").trim();
  const awsRegion = String(env.AWS_REGION_INPUT ?? "").trim();
  const huaweiCloudRegion = String(env.HUAWEICLOUD_REGION_INPUT ?? "").trim();
  const lambdaName = String(env.LAMBDA_NAME_INPUT ?? "").trim();
  const config = String(env.CONFIG_INPUT ?? "").trim();
  const args = [
    "daily",
    "--period",
    period,
    "--engine",
    engine,
    "--universe",
    universe,
    "--job-mode",
    jobMode,
    "--commit",
    "--allow-partial",
    "--concurrency",
    concurrency,
    "--retry-attempts",
    retryAttempts,
    "--retry-concurrency",
    retryConcurrency,
    "--batch-size",
    batchSize,
    "--min-success-rate",
    minSuccessRate,
  ];

  if (jobId) {
    args.push("--job-id", jobId);
  }

  if (chainDepth) {
    args.push("--chain-depth", chainDepth);
  }

  if (maxChainDepth) {
    args.push("--max-chain-depth", maxChainDepth);
  }

  if (awsRegion) {
    args.push("--aws-region", awsRegion);
  }

  if (huaweiCloudRegion) {
    args.push("--huaweicloud-region", huaweiCloudRegion);
  }

  if (lambdaName) {
    args.push("--lambda-name", lambdaName);
  }

  if (config) {
    args.push("--config", config);
  }

  if (isTruthy(env.FORCE_INPUT)) {
    args.push("--force");
  }

  if (isTruthy(env.FORCE_UNIVERSE_INPUT)) {
    args.push("--force-universe");
  }

  if (limit) {
    args.push("--limit", limit);
  }

  if (date) {
    args.push("--date", date);
  } else {
    args.push("--latest");
  }

  return args;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve(code ?? 1);
    });
  });
}

function runCapture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
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
    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

function argValue(args, flagName, fallback) {
  const index = args.indexOf(flagName);
  if (index === -1 || index + 1 >= args.length) {
    return fallback;
  }
  return args[index + 1];
}

function formatCounts(counts) {
  const entries = Object.entries(counts ?? {}).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    return "{}";
  }
  return entries.map(([key, value]) => `${key}: ${value}`).join(", ");
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return `${(value * 100).toFixed(2)}%`;
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=,@+-]+$/.test(text)) {
    return text;
  }
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function sanitizeBranchSegment(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isDataBranch(refName) {
  return /^data\/(daily|yearly)\//.test(String(refName ?? ""));
}

function dataBranchNameForRun(run, env = process.env) {
  const explicitBranch = String(env.DATA_BRANCH_NAME ?? "").trim();
  if (explicitBranch) {
    return explicitBranch;
  }
  const period = sanitizeBranchSegment(run?.period ?? "daily");
  const currentRef = String(env.GITHUB_REF_NAME ?? "").trim();
  if (isDataBranch(currentRef) && currentRef.startsWith(`data/${period}/`)) {
    return currentRef;
  }

  const date = sanitizeBranchSegment(run?.date);
  const universe = sanitizeBranchSegment(run?.universe ?? "market");
  const jobId = sanitizeBranchSegment(run?.job_id ?? `${date}-${period}-${universe}`);
  if (!period || !date || !jobId) {
    return null;
  }
  return `data/${period}/${date}-${universe}-${jobId}`;
}

async function checkoutDataBranch(branchName) {
  if (!branchName) {
    return null;
  }
  await runChecked("git", ["checkout", "-B", branchName]);
  return branchName;
}

async function pushDataBranch(branchName) {
  if (!branchName) {
    await runChecked("git", ["push"]);
    return null;
  }
  await runChecked("git", ["push", "--set-upstream", "origin", `HEAD:${branchName}`]);
  return branchName;
}

function dataPullRequestTitle(run) {
  return `data(${run.period}): ${run.date} ${run.universe} kline sync`;
}

function dataPullRequestBody(run, branchName) {
  return [
    "## Data sync",
    "",
    `- branch: ${branchName}`,
    `- date: ${run.date}`,
    `- period: ${run.period}`,
    `- universe: ${run.universe}`,
    `- job_id: ${run.job_id ?? "n/a"}`,
    `- status: ${run.job_status ?? run.status ?? "n/a"}`,
    `- total: ${run.total}`,
    `- success: ${run.success}`,
    `- failed: ${run.failed}`,
    `- skipped: ${run.skipped}`,
    `- freshness_codes: ${run.freshness_codes ?? "n/a"}`,
    `- stale_completed: ${run.stale_completed ?? 0}`,
    "",
    "## Validation",
    "",
    `- quality: ${run.artifacts?.quality ?? "n/a"}`,
    `- kline_summary: ${run.artifacts?.kline_summary ?? "n/a"}`,
    "",
  ].join("\n");
}

function shouldOpenDataPullRequest(run, branchName, env = process.env) {
  if (String(env.GITHUB_ACTIONS ?? "").toLowerCase() !== "true") {
    return false;
  }
  if (isTruthy(env.DISABLE_DATA_PR)) {
    return false;
  }
  return Boolean(
    branchName &&
      isDataBranch(branchName) &&
      run?.job_status === "completed" &&
      !run.should_dispatch_next
  );
}

function selectDataPullRequest(pullRequests) {
  if (!Array.isArray(pullRequests) || pullRequests.length === 0) {
    return null;
  }
  return pullRequests.find((pr) => pr.state === "OPEN") ??
    pullRequests.find((pr) => pr.state === "MERGED") ??
    pullRequests[0];
}

function buildDataPullRequestMergeArgs(pr) {
  const target = String(pr?.url ?? pr?.number ?? "").trim();
  if (!target) {
    throw new Error("Data pull request is missing a URL or number.");
  }
  return ["pr", "merge", target, "--auto", "--squash"];
}

function shouldEnableDataPullRequestAutoMerge(pr, env = process.env) {
  if (isTruthy(env.DISABLE_DATA_PR_AUTO_MERGE)) {
    return false;
  }
  return Boolean(pr?.url && (pr.state ?? "OPEN") === "OPEN");
}

async function maybeOpenDataPullRequest(run, branchName, env = process.env) {
  if (!shouldOpenDataPullRequest(run, branchName, env)) {
    return null;
  }

  const existing = await runCaptureChecked("gh", [
    "pr",
    "list",
    "--head",
    branchName,
    "--base",
    "master",
    "--state",
    "all",
    "--json",
    "number,url,state,mergedAt,headRefOid",
  ]);
  const parsed = JSON.parse(existing);
  const selected = selectDataPullRequest(parsed);
  if (selected) {
    return selected;
  }

  const stdout = await runCaptureChecked("gh", [
    "pr",
    "create",
    "--base",
    "master",
    "--head",
    branchName,
    "--title",
    dataPullRequestTitle(run),
    "--body",
    dataPullRequestBody(run, branchName),
  ]);
  const url = stdout.trim();
  const match = url.match(/\/pull\/(\d+)/);
  return {
    number: match ? Number(match[1]) : null,
    state: "OPEN",
    url,
  };
}

async function setupDataPullRequest(run, branchName, env = process.env) {
  const pr = await maybeOpenDataPullRequest(run, branchName, env);
  if (!pr) {
    return {
      autoMerge: null,
      pr: null,
    };
  }

  if (pr.state === "CLOSED") {
    throw new Error(`Data pull request ${pr.url} is closed and cannot be auto-merged.`);
  }

  if (!shouldEnableDataPullRequestAutoMerge(pr, env)) {
    return {
      autoMerge: {
        enabled: false,
        reason: pr.state === "MERGED" ? "already_merged" : "disabled",
      },
      pr,
    };
  }

  await runCaptureChecked("gh", buildDataPullRequestMergeArgs(pr));
  return {
    autoMerge: {
      enabled: true,
      reason: "enabled",
    },
    pr,
  };
}

async function writeGithubStepSummary(args, run = null) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryFile) {
    return;
  }

  const period = argValue(args, "--period", "daily");
  const summaryPath = path.join(ROOT, "data", "kline", period, `summary.${period}.json`);
  let summary;
  try {
    summary = JSON.parse(await fs.readFile(summaryPath, "utf8"));
  } catch (error) {
    await fs.appendFile(
      summaryFile,
      [
        "## Kline data summary",
        "",
        `Kline summary was not available: ${error.message}`,
        "",
      ].join("\n"),
      "utf8"
    );
    return;
  }

  const awsSuccesses = Number(summary.engine_counts?.aws ?? 0);
  const awsRouterSuccesses = Number(summary.engine_counts?.["aws-router"] ?? 0);
  const huaweiCloudSuccesses = Number(summary.engine_counts?.huaweicloud ?? 0);
  const universe = argValue(args, "--universe", "market");
  const lines = [
    "## Kline data summary",
    "",
    `- universe: ${universe}`,
    `- input_path: ${summary.input_path}`,
    `- period: ${summary.period}`,
    `- engine: ${summary.engine}`,
    `- total_codes: ${summary.total_codes}`,
    `- success: ${summary.success}`,
    `- failed: ${summary.failed}`,
    `- skipped_existing: ${summary.skipped_existing}`,
    `- batch_size: ${summary.batch_size}`,
    `- concurrency: ${summary.concurrency}`,
    `- selection_mode: ${summary.selection_mode}`,
    `- initial_failed: ${summary.initial_failed}`,
    `- retried: ${summary.retried}`,
    `- retry_success: ${summary.retry_success}`,
    `- retry_failed: ${summary.retry_failed}`,
    `- retry_concurrency: ${summary.retry_concurrency}`,
    `- success_rate: ${summary.success_rate}`,
    `- failure_reason_counts: ${formatCounts(summary.failure_reason_counts)}`,
    `- engine_counts: ${formatCounts(summary.engine_counts)}`,
    `- region_counts: ${formatCounts(summary.region_counts)}`,
    `- aws_successes: ${awsSuccesses}`,
    `- aws_router_successes: ${awsRouterSuccesses}`,
    `- huaweicloud_successes: ${huaweiCloudSuccesses}`,
    `- avg_duration_ms: ${summary.avg_duration_ms ?? "n/a"}`,
    `- p50_duration_ms: ${summary.p50_duration_ms ?? "n/a"}`,
    `- p95_duration_ms: ${summary.p95_duration_ms ?? "n/a"}`,
    `- status: ${summary.status}`,
    "",
  ];

  const latestRun = run ?? await findLatestRun();
  if (latestRun?.job_mode === "batch") {
    lines.push(
      "## Progress",
      "",
      `- job_id: ${latestRun.job_id}`,
      `- job_status: ${latestRun.job_status}`,
      `- progress_file: ${latestRun.progress_file}`,
      `- progress_counts: ${formatCounts(latestRun.progress_counts)}`,
      `- batch_codes: ${latestRun.progress_batch_codes}`,
      `- batch_source: ${latestRun.progress_batch_source}`,
      `- chain_depth: ${latestRun.chain_depth}`,
      `- max_chain_depth: ${latestRun.max_chain_depth}`,
      `- should_dispatch_next: ${latestRun.should_dispatch_next}`,
      ""
    );
  }

  await fs.appendFile(summaryFile, lines.join("\n"), "utf8");
}

async function runChecked(command, args) {
  const code = await run(command, args);
  if (code !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${code}`);
  }
}

async function runCaptureChecked(command, args) {
  const result = await runCapture(command, args);
  if (result.code !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.code}: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

async function findLatestRun({ sinceMs = null } = {}) {
  const runsDir = path.join(ROOT, "runs");
  let entries;
  try {
    entries = await fs.readdir(runsDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const runPath = path.join(runsDir, entry.name, "run.json");
    try {
      const stats = await fs.stat(runPath);
      if (sinceMs !== null && stats.mtimeMs < sinceMs) {
        continue;
      }
      candidates.push({ runPath, mtimeMs: stats.mtimeMs });
    } catch {}
  }

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  if (candidates.length === 0) {
    return null;
  }
  return JSON.parse(await fs.readFile(candidates[0].runPath, "utf8"));
}

function shouldDispatchNextRun(run, env = process.env) {
  if (String(env.GITHUB_ACTIONS ?? "").toLowerCase() !== "true") {
    return false;
  }
  if (isTruthy(env.DISABLE_CHAIN_DISPATCH)) {
    return false;
  }
  return Boolean(
    run?.should_dispatch_next &&
      run.job_mode === "batch" &&
      run.job_status === "running" &&
      Number(run.chain_depth) < Number(run.max_chain_depth)
  );
}

function addDispatchInput(args, name, value) {
  if (value === null || value === undefined || value === "") {
    return;
  }
  args.push("-f", `${name}=${value}`);
}

function buildDispatchArgs(run, env = process.env) {
  const workflowName = env.GITHUB_WORKFLOW || "Daily Data Commit";
  const ref = dataBranchNameForRun(run, env) || env.GITHUB_REF_NAME || "master";
  const nextChainDepth = Number(run.chain_depth ?? 0) + 1;
  const args = ["workflow", "run", workflowName, "--ref", ref];

  addDispatchInput(args, "date", run.date);
  addDispatchInput(args, "period", run.period);
  addDispatchInput(args, "universe", run.universe);
  addDispatchInput(args, "engine", run.engine);
  addDispatchInput(args, "batch_size", run.batch_size);
  addDispatchInput(args, "concurrency", run.concurrency ?? "1");
  addDispatchInput(args, "retry_attempts", run.retry_attempts);
  addDispatchInput(args, "retry_concurrency", run.retry_concurrency ?? "1");
  addDispatchInput(args, "min_success_rate", run.min_success_rate);
  addDispatchInput(args, "force", run.force ? "true" : "false");
  addDispatchInput(args, "job_mode", "batch");
  addDispatchInput(args, "job_id", run.job_id);
  addDispatchInput(args, "chain_depth", nextChainDepth);
  addDispatchInput(args, "max_chain_depth", run.max_chain_depth);
  addDispatchInput(args, "aws_region", run.aws_region);
  addDispatchInput(args, "huaweicloud_region", run.huaweicloud_region);
  addDispatchInput(args, "lambda_name", run.lambda_name);
  addDispatchInput(args, "config", run.config);
  return args;
}

function runUrl(env = process.env) {
  if (!env.GITHUB_REPOSITORY || !env.GITHUB_RUN_ID) {
    return null;
  }
  const serverUrl = String(env.GITHUB_SERVER_URL || "https://github.com").replace(/\/$/, "");
  return `${serverUrl}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
}

function issueStatusForRun(run, { dailyCode = 0, dataPullRequestError = null, dispatchError = null } = {}) {
  if (dispatchError || dataPullRequestError) {
    return "failed";
  }
  if (run?.job_status === "completed") {
    return "completed";
  }
  if (run?.job_status === "blocked") {
    return "blocked";
  }
  if (dailyCode !== 0 && !run?.should_dispatch_next) {
    return "failed";
  }
  return "running";
}

function buildIssueTitle(run) {
  return `Kline sync ${run.date} ${run.period} ${run.universe} ${run.job_id}`;
}

function progressCompletionRate(run) {
  const counts = run?.progress_counts ?? {};
  const completed = Number(counts.completed ?? 0);
  const total = completed + Number(counts.pending ?? 0) + Number(counts.failed ?? 0) + Number(counts.blocked ?? 0);
  return total > 0 ? completed / total : null;
}

function formatDataPullRequestAutoMerge(autoMerge) {
  if (!autoMerge) {
    return "n/a";
  }
  return autoMerge.enabled ? "enabled" : autoMerge.reason ?? "disabled";
}

function buildIssueBody(run, {
  dailyCode = 0,
  dataPullRequest = null,
  dataPullRequestAutoMerge = null,
  dataPullRequestError = null,
  dispatchError = null,
  dispatchNext = false,
  env = process.env,
} = {}) {
  const counts = run?.progress_counts ?? {};
  const status = issueStatusForRun(run, { dailyCode, dataPullRequestError, dispatchError });
  const actionRunUrl = runUrl(env);
  const resumeCommand = run?.job_status === "completed"
    ? "n/a"
    : `gh ${buildDispatchArgs(run, env).map(shellQuote).join(" ")}`;
  return [
    "## Kline sync",
    "",
    `- status: ${status}`,
    `- job_id: ${run.job_id}`,
    `- job_status: ${run.job_status}`,
    `- date: ${run.date}`,
    `- period: ${run.period}`,
    `- universe: ${run.universe}`,
    `- engine: ${run.engine}`,
    `- batch_size: ${run.batch_size}`,
    `- batch_codes: ${run.progress_batch_codes}`,
    `- batch_source: ${run.progress_batch_source}`,
    `- chain_depth: ${run.chain_depth}`,
    `- max_chain_depth: ${run.max_chain_depth}`,
    `- completed: ${counts.completed ?? 0}`,
    `- pending: ${counts.pending ?? 0}`,
    `- failed: ${counts.failed ?? 0}`,
    `- blocked: ${counts.blocked ?? 0}`,
    `- completion_rate: ${formatPercent(progressCompletionRate(run))}`,
    `- latest_run: ${actionRunUrl ?? "n/a"}`,
    `- progress_file: ${run.progress_file ?? "n/a"}`,
    `- kline_summary: ${run.artifacts?.kline_summary ?? "n/a"}`,
    `- dispatch_next: ${dispatchNext}`,
    `- workflow_exit_code: ${dailyCode}`,
    `- dispatch_error: ${dispatchError?.message ?? "n/a"}`,
    `- data_pr: ${dataPullRequest?.url ?? "n/a"}`,
    `- data_pr_state: ${dataPullRequest?.state ?? "n/a"}`,
    `- data_pr_auto_merge: ${formatDataPullRequestAutoMerge(dataPullRequestAutoMerge)}`,
    `- data_pr_error: ${dataPullRequestError?.message ?? "n/a"}`,
    "",
    "## Failure context",
    "",
    `- kline_failure_reasons: ${(run.kline_failure_reasons ?? []).join(", ") || "none"}`,
    `- kline_failure_reason_counts: ${formatCounts(run.kline_failure_reason_counts)}`,
    `- region_counts: ${formatCounts(run.kline_region_counts)}`,
    "",
    "## Resume",
    "",
    "```bash",
    resumeCommand,
    "```",
    "",
  ].join("\n");
}

function buildIssueComment(run, status, {
  dataPullRequest = null,
  dataPullRequestError = null,
  dispatchError = null,
  issueCreated = false,
} = {}) {
  if (status === "blocked") {
    return `Kline sync job \`${run.job_id}\` is blocked. Check the issue body for failed codes and the resume command.`;
  }
  if (status === "failed") {
    const error = dispatchError ?? dataPullRequestError;
    return `Kline sync job \`${run.job_id}\` failed${error ? `: ${error.message}` : "."}`;
  }
  if (status === "completed") {
    const prText = dataPullRequest?.url ? ` Data PR: ${dataPullRequest.url}.` : "";
    return `Kline sync job \`${run.job_id}\` completed.${prText}`;
  }
  if (issueCreated) {
    return `Started kline sync job \`${run.job_id}\`.`;
  }
  return null;
}

function shouldSyncJobIssue(run, env = process.env) {
  if (String(env.GITHUB_ACTIONS ?? "").toLowerCase() !== "true") {
    return false;
  }
  if (isTruthy(env.DISABLE_JOB_ISSUES)) {
    return false;
  }
  return Boolean(run?.job_mode === "batch" && run.job_id);
}

function issueLabelsForStatus(status) {
  return ["daily-sync", "kline", status];
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

async function findIssueByTitle(title) {
  const stdout = await runCaptureChecked("gh", buildIssueSearchArgs(title));
  const issues = JSON.parse(stdout);
  return issues.find((issue) => issue.title === title) ?? null;
}

async function createIssue(title, body, labels) {
  const args = ["issue", "create", "--title", title, "--body", body];
  for (const label of labels) {
    args.push("--label", label);
  }
  const stdout = await runCaptureChecked("gh", args);
  const match = stdout.match(/\/issues\/(\d+)/);
  if (!match) {
    throw new Error(`Unable to parse created issue number from gh output: ${stdout.trim()}`);
  }
  return {
    number: Number(match[1]),
    state: "OPEN",
    title,
    url: stdout.trim(),
  };
}

async function updateIssue(number, body, labels) {
  await runCaptureChecked("gh", ["issue", "edit", String(number), "--body", body, "--add-label", labels.join(",")]);
  for (const label of STATUS_LABELS.filter((item) => !labels.includes(item))) {
    await runCapture("gh", ["issue", "edit", String(number), "--remove-label", label]);
  }
}

async function syncJobIssue(run, {
  dailyCode = 0,
  dataPullRequest = null,
  dataPullRequestAutoMerge = null,
  dataPullRequestError = null,
  dispatchError = null,
  dispatchNext = false,
  env = process.env,
} = {}) {
  if (!shouldSyncJobIssue(run, env)) {
    return null;
  }

  await ensureIssueLabels();
  const status = issueStatusForRun(run, { dailyCode, dataPullRequestError, dispatchError });
  const title = buildIssueTitle(run);
  const body = buildIssueBody(run, {
    dailyCode,
    dataPullRequest,
    dataPullRequestAutoMerge,
    dataPullRequestError,
    dispatchError,
    dispatchNext,
    env,
  });
  const labels = issueLabelsForStatus(status);
  let issue = await findIssueByTitle(title);
  let issueCreated = false;

  if (!issue) {
    issue = await createIssue(title, body, labels);
    issueCreated = true;
  } else {
    if (issue.state === "CLOSED" && status !== "completed") {
      await runCaptureChecked("gh", ["issue", "reopen", String(issue.number)]);
    }
    await updateIssue(issue.number, body, labels);
  }

  const comment = buildIssueComment(run, status, {
    dataPullRequest,
    dataPullRequestError,
    dispatchError,
    issueCreated,
  });
  if (comment && status !== "completed") {
    await runCaptureChecked("gh", ["issue", "comment", String(issue.number), "--body", comment]);
  }
  if (status === "completed" && issue.state !== "CLOSED") {
    await runCaptureChecked("gh", ["issue", "close", String(issue.number), "--reason", "completed", "--comment", comment]);
  }

  return {
    issue,
    issueCreated,
    status,
  };
}

async function main() {
  await runChecked("git", ["pull", "--rebase"]);

  const dailyArgs = buildDailyArgs();
  const startedAtMs = Date.now();
  const dailyCode = await run(process.execPath, [path.join(ROOT, "bin/x"), ...dailyArgs]);
  const latestRun = await findLatestRun({ sinceMs: startedAtMs - 1000 });
  const dataBranch = dataBranchNameForRun(latestRun);
  if (dataBranch) {
    await checkoutDataBranch(dataBranch);
  }
  await writeGithubStepSummary(dailyArgs, latestRun);
  await pushDataBranch(dataBranch);

  const dispatchNext = shouldDispatchNextRun(latestRun);
  let dispatchError = null;
  if (dispatchNext) {
    try {
      await runChecked("gh", buildDispatchArgs(latestRun));
    } catch (error) {
      dispatchError = error;
    }
  }

  let dataPullRequest = null;
  let dataPullRequestAutoMerge = null;
  let dataPullRequestError = null;
  if (!dispatchNext && !dispatchError) {
    try {
      const setup = await setupDataPullRequest(latestRun, dataBranch);
      dataPullRequest = setup?.pr ?? null;
      dataPullRequestAutoMerge = setup?.autoMerge ?? null;
      if (dataPullRequest?.url) {
        console.log(`Data pull request: ${dataPullRequest.url}`);
      }
      if (dataPullRequestAutoMerge?.enabled) {
        console.log(`Data pull request auto-merge enabled: ${dataPullRequest.url}`);
      }
    } catch (error) {
      dataPullRequestError = error;
      console.error(`Data PR sync failed: ${error.message}`);
    }
  }

  try {
    await syncJobIssue(latestRun, {
      dailyCode,
      dataPullRequest,
      dataPullRequestAutoMerge,
      dataPullRequestError,
      dispatchError,
      dispatchNext,
    });
  } catch (error) {
    console.error(`Issue sync failed: ${error.message}`);
  }

  if (dispatchError) {
    throw dispatchError;
  }

  if (dataPullRequestError) {
    throw dataPullRequestError;
  }

  if (dailyCode !== 0 && !dispatchNext) {
    process.exit(dailyCode);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  buildDataPullRequestMergeArgs,
  buildIssueBody,
  buildIssueComment,
  buildIssueSearchArgs,
  buildIssueTitle,
  buildDailyArgs,
  buildDispatchArgs,
  dataBranchNameForRun,
  dataPullRequestBody,
  dataPullRequestTitle,
  isDataBranch,
  issueStatusForRun,
  selectDataPullRequest,
  shouldEnableDataPullRequestAutoMerge,
  shouldOpenDataPullRequest,
  shouldSyncJobIssue,
  shouldDispatchNextRun,
};
