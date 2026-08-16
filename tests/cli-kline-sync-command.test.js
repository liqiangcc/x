"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { appendKlineSyncOptions, buildKlineSyncArgs, createKlineSyncCommand, runKlineSyncCommand } = require("../src/adapters/cli/commands/kline_sync");

function sink() { let text = ""; return { write(v) { text += String(v); }, get text() { return text; } }; }

test("kline sync validates before resolving process infrastructure", async () => {
  let resolutions = 0;
  const factory = () => { resolutions += 1; return async () => ({}); };
  await assert.rejects(runKlineSyncCommand({ argv: [], createNodeScriptRunner: factory }), /kline sync requires <input_dir\|codes\.json>/);
  await assert.rejects(runKlineSyncCommand({ argv: ["codes.json", "--policy", "p", "--engine", "aws"], createNodeScriptRunner: factory }), /--policy and --engine cannot be used together\./);
  assert.equal(resolutions, 0);
});

test("kline sync preserves invocation and output protocol", async () => {
  const calls = []; const stdout = sink(); const stderr = sink();
  const result = await runKlineSyncCommand({
    argv: ["codes.json", "--engine", "aws", "--limit", "10", "--force"],
    nodeScriptRunner: async (...args) => { calls.push(args); return { stdout: "ok\n", stderr: "warn\n" }; }, stdout, stderr,
  });
  assert.deepEqual(calls, [["fetch/query_pool_klines.js", ["codes.json", "--period", "daily", "--engine", "aws", "--limit", "10", "--force"]]]);
  assert.deepEqual(result.args, calls[0][1]); assert.equal(stdout.text, "ok\n"); assert.equal(stderr.text, "warn\n");
});

test("shared mapper stays reusable by retry and daily", () => {
  const args = [];
  appendKlineSyncOptions(args, { policy: "p", outputDir: "out", concurrency: "4", retryAttempts: "3", expectedLatestDate: "20260817", freshnessCodes: "fresh.json" });
  assert.deepEqual(args, ["--policy", "p", "--output-dir", "out", "--concurrency", "4", "--retry-attempts", "3", "--expected-latest-date", "20260817", "--freshness-codes", "fresh.json"]);
});

test("factory forwards root lazily and builder preserves explicit period", async () => {
  const roots = [];
  const command = createKlineSyncCommand({ root: "/repo", createNodeScriptRunner({ root }) { roots.push(root); return async () => ({ stdout: "", stderr: "" }); } });
  await command(["codes.json"]); assert.deepEqual(roots, ["/repo"]);
  assert.deepEqual(buildKlineSyncArgs({ _: ["pool"], period: "yearly", policy: "p" }), ["pool", "--period", "yearly", "--policy", "p"]);
});
