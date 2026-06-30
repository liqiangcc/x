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
  const args = [
    "daily",
    "--period",
    period,
    "--engine",
    engine,
    "--universe",
    universe,
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

async function writeGithubStepSummary(args) {
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

  await fs.appendFile(summaryFile, lines.join("\n"), "utf8");
}

async function runChecked(command, args) {
  const code = await run(command, args);
  if (code !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${code}`);
  }
}

async function main() {
  await runChecked("git", ["pull", "--rebase"]);

  const dailyArgs = buildDailyArgs();
  const dailyCode = await run(process.execPath, [path.join(ROOT, "bin/x"), ...dailyArgs]);
  await writeGithubStepSummary(dailyArgs);
  if (dailyCode !== 0) {
    process.exit(dailyCode);
  }

  await runChecked("git", ["push"]);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  buildDailyArgs,
};
