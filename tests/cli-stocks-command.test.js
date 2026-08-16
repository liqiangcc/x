"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildStocksFetchArgs,
  createStocksCommand,
  normalizeStocksFetchDate,
  runStocksCommand,
} = require("../src/adapters/cli/commands/stocks");

function captureStream() {
  let value = "";
  return {
    stream: { write(chunk) { value += String(chunk); } },
    value: () => value,
  };
}

test("normalizeStocksFetchDate preserves legacy loose YYYYMMDD normalization", () => {
  assert.equal(normalizeStocksFetchDate("2026-08-17"), "20260817");
  assert.equal(normalizeStocksFetchDate("20260231"), "20260231");
  assert.throws(() => normalizeStocksFetchDate("bad"), /Invalid date: bad/);
});

test("buildStocksFetchArgs preserves defaults and latest behavior", () => {
  assert.deepEqual(buildStocksFetchArgs({ market: "hs-a", outputDir: "data/universe" }), [
    "--market", "hs-a", "--output-dir", "data/universe", "--latest",
  ]);
});

test("buildStocksFetchArgs maps explicit date and page size", () => {
  assert.deepEqual(buildStocksFetchArgs({
    market: "sz-a",
    outputDir: "tmp/universe",
    date: "2026-08-17",
    pageSize: "500",
  }), [
    "--market", "sz-a",
    "--output-dir", "tmp/universe",
    "--date", "20260817",
    "--page-size", "500",
  ]);
});

test("buildStocksFetchArgs rejects date/latest conflict before infrastructure", () => {
  assert.throws(
    () => buildStocksFetchArgs({ market: "hs-a", outputDir: "data/universe", date: "20260817", latest: true }),
    /--date and --latest cannot be used together\./,
  );
});

test("runStocksCommand preserves command protocol errors without resolving runner", async () => {
  let runnerResolved = false;
  await assert.rejects(
    () => runStocksCommand({
      argv: ["list"],
      createNodeScriptRunner() {
        runnerResolved = true;
        return async () => ({});
      },
    }),
    /Unknown stocks command: list/,
  );
  assert.equal(runnerResolved, false);
});

test("runStocksCommand launches market fetch script and forwards output", async () => {
  const stdout = captureStream();
  const stderr = captureStream();
  let invocation;
  const result = await runStocksCommand({
    argv: ["fetch", "--date", "2026-08-17", "--market", "hs-a", "--page-size", "1000"],
    nodeScriptRunner: async (scriptPath, args) => {
      invocation = { scriptPath, args };
      return { stdout: "ok\n", stderr: "warn\n" };
    },
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(invocation.scriptPath, "fetch/fetch_market_stocks.js");
  assert.deepEqual(invocation.args, [
    "--market", "hs-a",
    "--output-dir", "data/universe",
    "--date", "20260817",
    "--page-size", "1000",
  ]);
  assert.equal(stdout.value(), "ok\n");
  assert.equal(stderr.value(), "warn\n");
  assert.deepEqual(result.args, invocation.args);
});

test("createStocksCommand passes root to injected runner factory", async () => {
  let receivedRoot;
  const command = createStocksCommand({
    root: "/repo",
    outputDir: "custom/universe",
    createNodeScriptRunner({ root }) {
      receivedRoot = root;
      return async () => ({ stdout: "", stderr: "" });
    },
  });
  await command(["fetch"]);
  assert.equal(receivedRoot, "/repo");
});
