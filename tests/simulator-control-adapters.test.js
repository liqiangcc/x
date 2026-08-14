"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const {
  createLegacyTradingCalendarReader,
} = require("../src/simulator/adapters/ledger/legacy_trading_calendar_reader");
const {
  createNpmRuntimeLauncher,
} = require("../src/simulator/adapters/process/npm_runtime_launcher");

test("legacy trading calendar reader isolates calendar construction from Application", async () => {
  const calls = [];
  const reader = createLegacyTradingCalendarReader({
    marketDataRepository: {
      async getLegacyHistory(input) {
        calls.push(input);
        return {
          bars: [
            { date: "2026-01-02" },
            { date: "2026-01-05" },
            { date: "2026-01-06" },
          ],
        };
      },
    },
  });

  const calendar = await reader.readCalendar({
    startDate: "20260105",
    endDate: "20260106",
  });

  assert.deepEqual(calendar.dates, ["2026-01-05", "2026-01-06"]);
  assert.deepEqual(calendar.qualityIssues, ["trading_calendar_approximation"]);
  assert.deepEqual(calls, [{
    code: "000001",
    market: 0,
    endDate: "2026-01-06",
    period: "daily",
  }]);
});

test("npm simulator runtime launcher owns spawn command environment and successful close", async () => {
  const child = new EventEmitter();
  const calls = [];
  const launcher = createNpmRuntimeLauncher({
    cwd: "/repo",
    env: { KEEP: "yes" },
    spawnProcess(command, args, options) {
      calls.push({ command, args, options });
      return child;
    },
  });

  const completion = launcher.launch({ host: "0.0.0.0", port: "3100" });
  child.emit("close", 0);
  await completion;

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "npm");
  assert.deepEqual(calls[0].args, ["run", "dev:simulator"]);
  assert.equal(calls[0].options.cwd, "/repo");
  assert.equal(calls[0].options.stdio, "inherit");
  assert.deepEqual(calls[0].options.env, {
    KEEP: "yes",
    SIMULATOR_HOST: "0.0.0.0",
    SIMULATOR_PORT: "3100",
  });
});

test("npm simulator runtime launcher preserves nonzero-exit and spawn errors", async () => {
  const exitChild = new EventEmitter();
  const launcher = createNpmRuntimeLauncher({
    cwd: "/repo",
    spawnProcess() {
      return exitChild;
    },
  });
  const failed = launcher.launch({});
  exitChild.emit("close", 7);
  await assert.rejects(failed, /simulator exited with code 7/);

  const errorChild = new EventEmitter();
  const spawnErrorLauncher = createNpmRuntimeLauncher({
    cwd: "/repo",
    spawnProcess() {
      return errorChild;
    },
  });
  const errored = spawnErrorLauncher.launch({});
  const expected = new Error("spawn failed");
  errorChild.emit("error", expected);
  await assert.rejects(errored, (error) => error === expected);
});
