"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createStatsCommand,
  parseStatsOptions,
  runStatsCommand,
} = require("../src/adapters/cli/commands/stats");

function captureWriter() {
  let text = "";
  return {
    stream: {
      write(chunk) {
        text += String(chunk);
      },
    },
    value() {
      return text;
    },
  };
}

test("stats yearly-positive translates CLI options and prints JSON", async () => {
  const output = captureWriter();
  const calls = [];
  const result = await runStatsCommand({
    argv: [
      "yearly-positive",
      "--metric-column",
      "c4",
      "--stock-code",
      "000001",
      "--db",
      "fixture.db",
    ],
    yearlyPositiveUseCase: {
      execute(input) {
        calls.push(input);
        return [{ Year: "2024", PositivePercentage: "100.00%" }];
      },
    },
    newHighsUseCase: { execute() { throw new Error("not used"); } },
    stdout: output.stream,
  });

  assert.deepEqual(calls, [{
    dbFile: "fixture.db",
    metricColumn: "c4",
    stockCode: "000001",
  }]);
  assert.deepEqual(result, [{ Year: "2024", PositivePercentage: "100.00%" }]);
  assert.equal(
    output.value(),
    `${JSON.stringify(result, null, 2)}\n`
  );
});

test("stats new-highs preserves defaults and optional filters", async () => {
  const output = captureWriter();
  const calls = [];
  await runStatsCommand({
    argv: ["new-highs", "--year", "2024"],
    yearlyPositiveUseCase: { execute() { throw new Error("not used"); } },
    newHighsUseCase: {
      execute(input) {
        calls.push(input);
        return [];
      },
    },
    stdout: output.stream,
  });

  assert.deepEqual(calls, [{
    dbFile: "mydb.db",
    year: "2024",
    date: null,
  }]);
  assert.equal(output.value(), "[]\n");
});

test("stats command preserves legacy validation and unknown-command errors", async () => {
  const dependencies = {
    yearlyPositiveUseCase: { execute() { return []; } },
    newHighsUseCase: { execute() { return []; } },
  };

  await assert.rejects(
    () => runStatsCommand({ argv: ["yearly-positive"], ...dependencies }),
    /stats yearly-positive requires --metric-column <column>/
  );
  await assert.rejects(
    () => runStatsCommand({ argv: ["unknown"], ...dependencies }),
    /Unknown stats command: unknown/
  );
});

test("stats option parser preserves legacy boolean option semantics", () => {
  const options = parseStatsOptions([
    "--json",
    "--metric-column",
    "c4",
    "tail",
  ], { db: "mydb.db" });

  assert.equal(options.json, true);
  assert.equal(options.metricColumn, "c4");
  assert.equal(options.db, "mydb.db");
  assert.deepEqual(options._, ["tail"]);
});

test("createStatsCommand accepts an explicit row reader", async () => {
  const output = captureWriter();
  const calls = [];
  const command = createStatsCommand({
    sqlRowReader: {
      queryRows(input) {
        calls.push(input);
        return [{ Year: "2024" }];
      },
    },
    stdout: output.stream,
  });

  await command(["yearly-positive", "--metric-column", "c4"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].dbFile, "mydb.db");
  assert.match(calls[0].sql, /WITH Changes AS/);
  assert.equal(output.value(), '[\n  {\n    "Year": "2024"\n  }\n]\n');
});
