"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  createKlineAggregateYearlyCommand,
  runKlineAggregateYearlyCommand,
} = require("../src/adapters/cli/commands/kline_aggregate_yearly");

function capture() {
  let value = "";
  return {
    stream: { write(chunk) { value += chunk; } },
    value: () => value,
  };
}

test("kline aggregate-yearly validates CLI requirements before resolving dependencies", async () => {
  let resolutions = 0;
  const command = createKlineAggregateYearlyCommand({
    root: "/repo",
    createCodesInputReader() {
      resolutions += 1;
      throw new Error("should not resolve");
    },
    aggregateYearly: async () => ({ failed: 0 }),
  });

  await assert.rejects(
    () => command([]),
    /kline aggregate-yearly requires <input_dir\|codes\.json>\./,
  );
  await assert.rejects(
    () => command(["codes.json"]),
    /kline aggregate-yearly requires --date YYYYMMDD\./,
  );
  await assert.rejects(
    () => command(["codes.json", "--date"]),
    /Missing value for --date/,
  );
  assert.equal(resolutions, 0);
});

test("kline aggregate-yearly maps input, date, concurrency, output, and exit policy", async () => {
  const out = capture();
  const calls = [];
  const exits = [];
  const resultPayload = { targetDate: "2026-08-17", total: 2, updated: 1, skipped: 0, failed: 1, items: [] };

  const result = await runKlineAggregateYearlyCommand({
    argv: ["data/pool", "--date", "20260817", "--concurrency", "4"],
    klineRoot: "/repo/data/kline",
    readCodesInput: async (inputPath) => {
      calls.push(["read", inputPath]);
      return ["000001", "600000"];
    },
    aggregateYearly: async (request) => {
      calls.push(["aggregate", request]);
      return resultPayload;
    },
    stdout: out.stream,
    setExitCode: (code) => exits.push(code),
  });

  assert.deepEqual(calls, [
    ["read", "data/pool"],
    ["aggregate", {
      codes: ["000001", "600000"],
      concurrency: 4,
      klineRoot: "/repo/data/kline",
      targetDate: "20260817",
    }],
  ]);
  assert.equal(out.value(), `${JSON.stringify(resultPayload, null, 2)}\n`);
  assert.deepEqual(exits, [1]);
  assert.equal(result.concurrency, 4);
  assert.equal(result.inputPath, "data/pool");
  assert.equal(result.result, resultPayload);
});

test("kline aggregate-yearly preserves invalid concurrency fallback to 16", async () => {
  for (const concurrency of ["0", "-1", "3.5", "nope"]) {
    let seen;
    await runKlineAggregateYearlyCommand({
      argv: ["codes.json", "--date", "20260817", "--concurrency", concurrency],
      klineRoot: "/repo/data/kline",
      readCodesInput: async () => ["000001"],
      aggregateYearly: async (request) => {
        seen = request.concurrency;
        return { failed: 0 };
      },
      stdout: { write() {} },
      setExitCode() {
        throw new Error("unexpected exit code");
      },
    });
    assert.equal(seen, 16, concurrency);
  }
});

test("kline aggregate-yearly defaults concurrency to 16 and does not set success exit code", async () => {
  const exits = [];
  let request;
  await runKlineAggregateYearlyCommand({
    argv: ["codes.json", "--date", "2026-08-17"],
    klineRoot: "/repo/data/kline",
    readCodesInput: async () => ["000001"],
    aggregateYearly: async (value) => {
      request = value;
      return { failed: 0, items: [] };
    },
    stdout: { write() {} },
    setExitCode: (code) => exits.push(code),
  });
  assert.equal(request.concurrency, 16);
  assert.equal(request.targetDate, "2026-08-17");
  assert.deepEqual(exits, []);
});

test("kline aggregate-yearly composition resolves reader lazily with repo root", async () => {
  const root = path.join(path.sep, "repo");
  const calls = [];
  const command = createKlineAggregateYearlyCommand({
    root,
    createCodesInputReader(options) {
      calls.push(["factory", options]);
      return async (inputPath) => {
        calls.push(["read", inputPath]);
        return ["600000"];
      };
    },
    aggregateYearly: async (request) => {
      calls.push(["aggregate", request]);
      return { failed: 0 };
    },
    stdout: { write() {} },
  });

  await command(["codes.json", "--date", "20260817"]);
  assert.deepEqual(calls[0], ["factory", { root }]);
  assert.deepEqual(calls[1], ["read", "codes.json"]);
  assert.equal(calls[2][1].klineRoot, path.join(root, "data", "kline"));
});
