#!/usr/bin/env node

"use strict";

const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");

function valueOrDefault(value, fallback) {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function buildDailyArgs(env = process.env) {
  const period = valueOrDefault(env.PERIOD_INPUT, "daily");
  const limit = valueOrDefault(env.LIMIT_INPUT, "10");
  const engine = valueOrDefault(env.ENGINE_INPUT, "auto");
  const date = String(env.DATE_INPUT ?? "").trim();
  const args = ["daily", "--period", period, "--limit", limit, "--engine", engine, "--commit"];

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

async function runChecked(command, args) {
  const code = await run(command, args);
  if (code !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${code}`);
  }
}

async function main() {
  await runChecked("git", ["pull", "--rebase"]);

  const dailyCode = await run(process.execPath, [path.join(ROOT, "bin/x"), ...buildDailyArgs()]);
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
