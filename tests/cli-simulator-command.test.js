"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  SIMULATOR_USAGE,
  createSimulatorCommand,
  parseSimulatorOptions,
  runSimulatorCommand,
} = require("../src/adapters/cli/commands/simulator");

function outputBuffer() {
  let text = "";
  return {
    stream: { write(chunk) { text += String(chunk); } },
    text: () => text,
  };
}

test("simulator help is protocol-only and does not require application dependencies", async () => {
  const output = outputBuffer();
  await runSimulatorCommand({
    argv: ["--help"],
    stdout: output.stream,
  });
  assert.equal(output.text(), `${SIMULATOR_USAGE}\n`);
});

test("simulator start preserves default and explicit host/port mapping", async () => {
  const calls = [];
  const startRuntimeUseCase = {
    async execute(input) {
      calls.push(input);
    },
  };

  await runSimulatorCommand({ argv: ["start"], startRuntimeUseCase });
  await runSimulatorCommand({
    argv: ["start", "--host", "0.0.0.0", "--port", "3100"],
    startRuntimeUseCase,
  });

  assert.deepEqual(calls, [
    { host: "127.0.0.1", port: "3001" },
    { host: "0.0.0.0", port: "3100" },
  ]);
});

test("simulator check preserves JSON result shape and text presentation", async () => {
  const calls = [];
  const checkDataReadinessUseCase = {
    async execute(input) {
      calls.push(input);
      return {
        dataMode: "legacy_approximate",
        qualityIssues: ["trading_calendar_approximation"],
        tradingDateCount: 2,
        universeCount: 3,
        universeSource: "fixture",
      };
    },
  };

  const jsonOutput = outputBuffer();
  const jsonResult = await runSimulatorCommand({
    argv: ["check", "--start-date", "20260105", "--end-date", "20260106", "--json"],
    checkDataReadinessUseCase,
    stdout: jsonOutput.stream,
  });
  const expected = {
    dataMode: "legacy_approximate",
    databasePath: "var/simulator/simulator.db",
    qualityIssues: ["trading_calendar_approximation"],
    tradingDateCount: 2,
    universeCount: 3,
    universeSource: "fixture",
  };
  assert.deepEqual(jsonResult, expected);
  assert.equal(jsonOutput.text(), `${JSON.stringify(expected, null, 2)}\n`);

  const textOutput = outputBuffer();
  await runSimulatorCommand({
    argv: ["check", "--start-date", "20260105", "--end-date", "20260106"],
    checkDataReadinessUseCase,
    stdout: textOutput.stream,
  });
  assert.equal(
    textOutput.text(),
    "simulator data: 3 securities (fixture), 2 trading dates, legacy_approximate\n"
  );
  assert.deepEqual(calls, [
    { startDate: "20260105", endDate: "20260106" },
    { startDate: "20260105", endDate: "20260106" },
  ]);
});

test("simulator CLI preserves validation, unknown-command, and boolean parsing semantics", async () => {
  await assert.rejects(
    runSimulatorCommand({ argv: ["check", "--start-date", "20260105"] }),
    /simulator check requires --start-date and --end-date/
  );
  await assert.rejects(
    runSimulatorCommand({ argv: ["unknown"] }),
    /Unknown simulator command: unknown/
  );
  assert.deepEqual(
    parseSimulatorOptions(["--json", "--force", "--host", "0.0.0.0"]),
    { _: [], json: true, force: true, host: "0.0.0.0" }
  );
});

test("createSimulatorCommand accepts explicit use cases without constructing process or ledger adapters", async () => {
  const calls = [];
  const output = outputBuffer();
  const command = createSimulatorCommand({
    checkDataReadinessUseCase: {
      async execute(input) {
        calls.push(["check", input]);
        return {
          dataMode: "legacy_approximate",
          qualityIssues: [],
          tradingDateCount: 1,
          universeCount: 1,
          universeSource: "fixture",
        };
      },
    },
    startRuntimeUseCase: {
      async execute(input) {
        calls.push(["start", input]);
      },
    },
    stdout: output.stream,
  });

  await command(["start"]);
  await command(["check", "--start-date", "20260105", "--end-date", "20260105", "--json"]);
  assert.deepEqual(calls, [
    ["start", { host: "127.0.0.1", port: "3001" }],
    ["check", { startDate: "20260105", endDate: "20260105" }],
  ]);
});
