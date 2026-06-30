#!/usr/bin/env node

"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");

function valueOrDefault(value, fallback) {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function buildDailyArgs(env = process.env) {
  const period = valueOrDefault(env.PERIOD_INPUT, "daily");
  const limit = String(env.LIMIT_INPUT ?? "").trim();
  const engine = valueOrDefault(env.ENGINE_INPUT, "aws");
  const universe = valueOrDefault(env.UNIVERSE_INPUT, "market");
  const jobMode = valueOrDefault(env.JOB_MODE_INPUT, "batch");
  const concurrency = valueOrDefault(
    env.CONCURRENCY_INPUT,
    engine === "local" ? "4" : "1"
  );
  const retryAttempts = valueOrDefault(
    env.RETRY_ATTEMPTS_INPUT,
    engine === "aws" ? (period === "yearly" ? "5" : "3") : "0"
  );
  const retryConcurrency = valueOrDefault(env.RETRY_CONCURRENCY_INPUT, "1");
  const batchSize = valueOrDefault(env.BATCH_SIZE_INPUT, period === "yearly" ? "200" : "500");
  const minSuccessRate = valueOrDefault(env.MIN_SUCCESS_RATE_INPUT, "0.95");
  const date = String(env.DATE_INPUT ?? "").trim();
  const jobId = String(env.JOB_ID_INPUT ?? "").trim();
  const chainDepth = String(env.CHAIN_DEPTH_INPUT ?? "").trim();
  const maxChainDepth = String(env.MAX_CHAIN_DEPTH_INPUT ?? "").trim();
  const awsRegion = String(env.AWS_REGION_INPUT ?? "").trim();
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

  if (lambdaName) {
    args.push("--lambda-name", lambdaName);
  }

  if (config) {
    args.push("--config", config);
  }

  if (isTruthy(env.FORCE_INPUT)) {
    args.push("--force");
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
        "## Daily data summary",
        "",
        `Kline summary was not available: ${error.message}`,
        "",
      ].join("\n"),
      "utf8"
    );
    return;
  }

  const awsSuccesses = Number(summary.engine_counts?.aws ?? 0);
  const universe = argValue(args, "--universe", "market");
  const lines = [
    "## Daily data summary",
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
    `- selection_mode: ${summary.selection_mode}`,
    `- initial_failed: ${summary.initial_failed}`,
    `- retried: ${summary.retried}`,
    `- retry_success: ${summary.retry_success}`,
    `- retry_failed: ${summary.retry_failed}`,
    `- success_rate: ${summary.success_rate}`,
    `- failure_reason_counts: ${formatCounts(summary.failure_reason_counts)}`,
    `- engine_counts: ${formatCounts(summary.engine_counts)}`,
    `- region_counts: ${formatCounts(summary.region_counts)}`,
    `- aws_successes: ${awsSuccesses}`,
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
  const ref = env.GITHUB_REF_NAME || "master";
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
  addDispatchInput(args, "lambda_name", run.lambda_name);
  addDispatchInput(args, "config", run.config);
  return args;
}

async function main() {
  await runChecked("git", ["pull", "--rebase"]);

  const dailyArgs = buildDailyArgs();
  const startedAtMs = Date.now();
  const dailyCode = await run(process.execPath, [path.join(ROOT, "bin/x"), ...dailyArgs]);
  const latestRun = await findLatestRun({ sinceMs: startedAtMs - 1000 });
  await writeGithubStepSummary(dailyArgs, latestRun);
  await runChecked("git", ["push"]);

  const dispatchNext = shouldDispatchNextRun(latestRun);
  if (dispatchNext) {
    await runChecked("gh", buildDispatchArgs(latestRun));
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
  buildDailyArgs,
  buildDispatchArgs,
  shouldDispatchNextRun,
};
