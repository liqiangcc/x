"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildKlineFetchArgs,
  createKlineFetchCommand,
  runKlineFetchCommand,
} = require("../src/adapters/cli/commands/kline_fetch");

function sink() {
  let text = "";
  return {
    write(value) { text += String(value); },
    get text() { return text; },
  };
}

test("kline fetch validates required input before resolving process infrastructure", async () => {
  let resolutions = 0;
  await assert.rejects(
    runKlineFetchCommand({
      argv: [],
      createNodeScriptRunner() {
        resolutions += 1;
        return async () => ({});
      },
    }),
    /kline fetch requires <code_or_secid>/,
  );
  assert.equal(resolutions, 0);
});

test("kline fetch rejects policy and engine together before resolving runner", async () => {
  let resolutions = 0;
  await assert.rejects(
    runKlineFetchCommand({
      argv: ["1.600519", "--policy", "proxy-only", "--engine", "aws"],
      createNodeScriptRunner() {
        resolutions += 1;
        return async () => ({});
      },
    }),
    /--policy and --engine cannot be used together\./,
  );
  assert.equal(resolutions, 0);
});

test("kline fetch preserves default period and exact script invocation", async () => {
  const calls = [];
  const stdout = sink();
  const stderr = sink();
  await runKlineFetchCommand({
    argv: ["1.600519", "--engine", "aws"],
    nodeScriptRunner: async (...args) => {
      calls.push(args);
      return { stdout: "ok\n", stderr: "warn\n" };
    },
    stdout,
    stderr,
  });
  assert.deepEqual(calls, [["fetch/fetch_kline.js", [
    "1.600519", "--period", "daily", "--engine", "aws",
  ]]]);
  assert.equal(stdout.text, "ok\n");
  assert.equal(stderr.text, "warn\n");
});

test("kline fetch maps only its historical transport and output options", () => {
  assert.deepEqual(buildKlineFetchArgs({
    _: ["0.300750"],
    period: "yearly",
    policy: "proxy-only",
    awsRegion: "r1,r2",
    routerRegion: "auto",
    proxyPoolUrl: "http://proxy",
    proxyMaxAttempts: "5",
    huaweicloudRegion: "all",
    huaweicloudRegionStartIndex: "2",
    huaweicloudTargets: "targets.json",
    lambdaName: "kline",
    config: "config.json",
    output: "out.json",
    retryAttempts: "9",
    limit: "10",
  }), [
    "0.300750", "--period", "yearly", "--policy", "proxy-only",
    "--aws-region", "r1,r2", "--router-region", "auto",
    "--proxy-pool-url", "http://proxy", "--proxy-max-attempts", "5",
    "--huaweicloud-region", "all", "--huaweicloud-region-start-index", "2",
    "--huaweicloud-targets", "targets.json", "--lambda-name", "kline",
    "--config", "config.json", "--output", "out.json",
  ]);
});

test("kline fetch factory forwards root lazily to runner factory", async () => {
  const roots = [];
  const command = createKlineFetchCommand({
    root: "/repo",
    createNodeScriptRunner({ root }) {
      roots.push(root);
      return async () => ({ stdout: "", stderr: "" });
    },
  });
  assert.deepEqual(roots, []);
  await command(["1.600519"]);
  assert.deepEqual(roots, ["/repo"]);
});
