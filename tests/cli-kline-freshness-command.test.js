"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  buildSuggestedSyncCommand,
  createKlineFreshnessCommand,
  formatKlineFreshnessText,
} = require("../src/adapters/cli/commands/kline_freshness");

function createOutput() {
  return {
    value: "",
    write(chunk) {
      this.value += chunk;
      return true;
    },
  };
}

function baseReport(overrides = {}) {
  return {
    period: "daily",
    target_root: "/repo/data/kline",
    codes_file: "/repo/data/codes.json",
    expected_latest_date: "2026-08-17",
    expected_date_source: "explicit",
    universe_count: 4,
    existing_file_count: 3,
    valid_count: 2,
    fresh_count: 1,
    stale_count: 1,
    missing_count: 1,
    invalid_count: 1,
    extra_count: 0,
    repair_count: 3,
    fresh_rate: 0.25,
    earliest_latest_date: "2026-08-16",
    latest_latest_date: "2026-08-17",
    latest_date_distribution: {
      "2026-08-17": 1,
      "2026-08-16": 1,
    },
    categories: {},
    repair_codes: ["000002", "000003", "000004"],
    ...overrides,
  };
}

test("protocol validation happens before freshness module resolution", async () => {
  let moduleLoads = 0;
  const command = createKlineFreshnessCommand({
    root: "/repo",
    loadFreshnessModule() {
      moduleLoads += 1;
      throw new Error("should not load");
    },
  });

  await assert.rejects(
    command(["--period", "weekly", "--codes", "codes.json"]),
    { message: "kline freshness requires --period daily|yearly." },
  );
  await assert.rejects(
    command(["--period", "daily"]),
    { message: "kline freshness requires --codes <codes.json>." },
  );
  await assert.rejects(
    command(["--period"]),
    { message: "Missing value for --period" },
  );
  assert.equal(moduleLoads, 0);
});

test("json mode preserves default target mapping and inspect request", async () => {
  const stdout = createOutput();
  let request;
  const command = createKlineFreshnessCommand({
    root: "/repo",
    stdout,
    async inspectFreshness(value) {
      request = value;
      return baseReport();
    },
  });

  const result = await command([
    "--period", "daily",
    "--codes", "data/codes.json",
    "--expected-latest-date", "20260817",
    "--json",
  ]);

  assert.deepEqual(request, {
    codesFile: path.join("/repo", "data/codes.json"),
    expectedLatestDate: "20260817",
    period: "daily",
    targetRoot: path.join("/repo", "data/kline"),
  });
  assert.equal(result.report.repair_output, null);
  assert.equal(result.report.suggested_sync_command, null);
  assert.equal(stdout.value, `${JSON.stringify(result.report, null, 2)}\n`);
});

test("repair output is written before text presentation and sync suggestion is preserved", async () => {
  const stdout = createOutput();
  const report = baseReport({ period: "yearly" });
  let repairCall;
  const command = createKlineFreshnessCommand({
    root: "/repo",
    stdout,
    async inspectFreshness() {
      return report;
    },
    async writeRepairCodes(outputFile, value) {
      repairCall = { outputFile, value };
    },
  });

  const result = await command([
    "custom/kline",
    "--period", "yearly",
    "--codes", "codes.json",
    "--repair-output", "runs/repair.json",
  ]);

  const repairOutput = path.join("/repo", "runs/repair.json");
  assert.equal(repairCall.outputFile, repairOutput);
  assert.equal(repairCall.value, report);
  assert.equal(result.targetRoot, path.join("/repo", "custom/kline"));
  assert.equal(result.report.repair_output, repairOutput);
  assert.equal(
    result.report.suggested_sync_command,
    `bin/x kline sync ${repairOutput} --period yearly --policy proxy-only --expected-latest-date 20260817 --freshness-codes ${repairOutput}`,
  );
  assert.equal(stdout.value, formatKlineFreshnessText(result.report));
  assert.match(stdout.value, /2026-08-17\t1\n2026-08-16\t1\n/);
  assert.match(stdout.value, /Fresh rate: 25\.00%/);
});

test("freshness module loader is lazy and cached across repeated calls", async () => {
  const stdout = createOutput();
  let moduleLoads = 0;
  const command = createKlineFreshnessCommand({
    root: "/repo",
    stdout,
    loadFreshnessModule() {
      moduleLoads += 1;
      return {
        async inspectFreshness() {
          return baseReport();
        },
        async writeRepairCodes() {},
      };
    },
  });

  await command(["--period", "daily", "--codes", "codes.json", "--json"]);
  stdout.value = "";
  await command([
    "--period", "daily",
    "--codes", "codes.json",
    "--repair-output", "repair.json",
    "--json",
  ]);
  assert.equal(moduleLoads, 1);
});

test("suggested sync command preserves legacy token layout", () => {
  assert.equal(
    buildSuggestedSyncCommand("/tmp/repair.json", {
      period: "daily",
      expected_latest_date: "2026-08-17",
    }),
    "bin/x kline sync /tmp/repair.json --period daily --policy proxy-only --expected-latest-date 20260817 --freshness-codes /tmp/repair.json",
  );
});
