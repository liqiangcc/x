"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  createReportCommand,
  normalizeReportDate,
  runReportCommand,
} = require("../src/adapters/cli/commands/report");

function captureStdout() {
  let output = "";
  return {
    stream: { write(chunk) { output += String(chunk); } },
    read: () => output,
  };
}

test("normalizeReportDate preserves legacy report CLI date normalization", () => {
  assert.equal(normalizeReportDate("20260817"), "20260817");
  assert.equal(normalizeReportDate("2026-08-17"), "20260817");
  assert.equal(normalizeReportDate("20260231"), "20260231");
  assert.throws(() => normalizeReportDate("2026/08/17"), /Invalid date: 2026\/08\/17/);
});

test("report daily maps CLI protocol to the existing report generator", async () => {
  const stdout = captureStdout();
  const calls = [];
  const root = path.join("", "workspace", "x");
  const klineDir = path.join(root, "data", "kline");
  const poolDir = path.join(root, "data", "pool");
  const outputDir = path.join(root, "reports");

  const result = await runReportCommand({
    argv: ["daily", "--date", "2026-08-17"],
    generateReport: async (request) => {
      calls.push(request);
      return { reportDir: path.join(outputDir, "20260817"), summary: { candidate_count: 3 } };
    },
    klineDir,
    outputDir,
    poolDir,
    root,
    stdout: stdout.stream,
  });

  assert.deepEqual(calls, [{ date: "20260817", klineDir, outputDir, poolDir }]);
  assert.equal(result.date, "20260817");
  assert.equal(result.reportPath, "reports/20260817");
  assert.equal(stdout.read(), "reports/20260817\n");
});

test("report protocol validation happens before lazy report generator resolution", async () => {
  for (const argv of [
    ["weekly"],
    ["daily"],
    ["daily", "--date", "bad"],
    ["daily", "--date"],
  ]) {
    let resolved = false;
    await assert.rejects(
      runReportCommand({
        argv,
        createReportGenerator: () => {
          resolved = true;
          throw new Error("must not resolve");
        },
        root: "/repo",
      }),
    );
    assert.equal(resolved, false, argv.join(" "));
  }
});

test("report command preserves legacy error messages", async () => {
  await assert.rejects(
    runReportCommand({ argv: ["weekly"], root: "/repo" }),
    /Unknown report command: weekly/,
  );
  await assert.rejects(
    runReportCommand({ argv: ["daily"], root: "/repo" }),
    /report daily requires --date <YYYYMMDD>/,
  );
  await assert.rejects(
    runReportCommand({ argv: ["daily", "--date"], root: "/repo" }),
    /Missing value for --date/,
  );
});

test("createReportCommand composes injected report generator without extra application layers", async () => {
  const stdout = captureStdout();
  const root = "/repo";
  const command = createReportCommand({
    root,
    klineDir: "/repo/data/kline",
    poolDir: "/repo/data/pool",
    stdout: stdout.stream,
    generateReport: async ({ date }) => ({ reportDir: `/repo/reports/${date}` }),
  });

  await command(["daily", "--date", "20260817"]);
  assert.equal(stdout.read(), "reports/20260817\n");
});

test("report command requires an executable generator only after valid protocol", async () => {
  await assert.rejects(
    runReportCommand({
      argv: ["daily", "--date", "20260817"],
      root: "/repo",
    }),
    /daily report generator must be a function/,
  );
});
