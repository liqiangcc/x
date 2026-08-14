"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");
const {
  createExecAwsMaintenanceRuntime,
} = require("../src/adapters/aws/exec_maintenance_runtime");

function createExecMock(handler) {
  function execFileImpl() {
    throw new Error("callback form should not be used by this test");
  }
  execFileImpl[promisify.custom] = handler;
  return execFileImpl;
}

test("maintenance runtime delegates AWS reads and preserves kline preflight command", async () => {
  const calls = [];
  const execFileImpl = createExecMock(async (command, args, options = {}) => {
    calls.push({ command, args, options });
    const key = [command, ...args].join(" ");
    if (key === "aws --version") return { stdout: "aws-cli/2\n", stderr: "" };
    if (key === "aws configure get aws_access_key_id --profile default") return { stdout: "AKIA_TEST\n", stderr: "" };
    if (key === "aws configure get aws_secret_access_key --profile default") return { stdout: "secret\n", stderr: "" };
    if (key === "aws configure get aws_session_token --profile default") return { stdout: "", stderr: "" };
    if (key === "aws sts get-caller-identity --profile default --output json") {
      return { stdout: JSON.stringify({ Account: "123", Arn: "arn:test", UserId: "u" }), stderr: "" };
    }
    if (command === "node") {
      return {
        stdout: JSON.stringify({
          data: { code: "600519", klines: ["a", "b"] },
          source_engine: "aws",
          source_region: "ap-northeast-1",
        }),
        stderr: "",
      };
    }
    throw new Error(`Unexpected command: ${key}`);
  });

  const runtime = createExecAwsMaintenanceRuntime({
    root: "/repo",
    env: { PATH: "/bin" },
    execFileImpl,
  });

  assert.deepEqual(await runtime.getToolVersion("aws", ["--version"]), {
    ok: true,
    version: "aws-cli/2",
  });
  assert.deepEqual(await runtime.readCredentials("default"), {
    accessKeyId: "AKIA_TEST",
    secretAccessKey: "secret",
    sessionToken: "",
  });
  assert.deepEqual(await runtime.getIdentity("default"), {
    account: "123",
    arn: "arn:test",
    user_id: "u",
  });
  assert.deepEqual(await runtime.runKlinePreflight({
    profile: "default",
    preflightRegion: "ap-northeast-1,ap-northeast-2",
    lambdaName: "kline",
  }), {
    ok: true,
    code: "600519",
    points: 2,
    source_engine: "aws",
    source_region: "ap-northeast-1",
  });

  const preflightCall = calls.find((call) => call.command === "node");
  assert.deepEqual(preflightCall.args, [
    path.join("/repo", "fetch", "fetch_kline.js"),
    "600519",
    "--period",
    "daily",
    "--engine",
    "aws",
    "--lambda-name",
    "kline",
    "--aws-region",
    "ap-northeast-1,ap-northeast-2",
  ]);
  assert.equal(preflightCall.options.cwd, "/repo");
  assert.equal(preflightCall.options.env.AWS_PROFILE, "default");
  assert.equal(preflightCall.options.env.AWS_SDK_LOAD_CONFIG, "1");
  assert.equal(preflightCall.options.env.NODE_NO_WARNINGS, "1");
});

test("maintenance runtime maps preflight process and parse failures to old result contract", async () => {
  const processFailure = new Error("failed");
  processFailure.code = 7;
  processFailure.stderr = " noisy   failure ";
  const failedExec = createExecMock(async (command) => {
    if (command === "node") throw processFailure;
    throw new Error("unexpected");
  });
  const failedRuntime = createExecAwsMaintenanceRuntime({
    root: "/repo",
    execFileImpl: failedExec,
  });
  assert.deepEqual(await failedRuntime.runKlinePreflight({
    profile: "default",
    preflightRegion: null,
    lambdaName: "kline",
  }), { ok: false, error: "noisy failure" });

  const badJsonExec = createExecMock(async (command) => {
    if (command === "node") return { stdout: "not-json", stderr: "" };
    throw new Error("unexpected");
  });
  const badJsonRuntime = createExecAwsMaintenanceRuntime({
    root: "/repo",
    execFileImpl: badJsonExec,
  });
  const result = await badJsonRuntime.runKlinePreflight({
    profile: "default",
    preflightRegion: null,
    lambdaName: "kline",
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /^Failed to parse AWS kline preflight output:/);
});

test("maintenance runtime keeps GitHub secret values on stdin and region in variable args", async () => {
  const execCalls = [];
  const spawnCalls = [];
  const execFileImpl = createExecMock(async (command, args, options = {}) => {
    execCalls.push({ command, args, options });
    return { stdout: "", stderr: "" };
  });
  const runtime = createExecAwsMaintenanceRuntime({
    root: "/repo",
    env: { PATH: "/bin" },
    execFileImpl,
    spawnCommand: async (command, args, input, options) => {
      spawnCalls.push({ command, args, input, options });
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(await runtime.resolveRepository("owner/repo"), "owner/repo");
  await runtime.setSecret({
    name: "AWS_ACCESS_KEY_ID",
    repo: "owner/repo",
    value: "AKIA_TEST",
  });
  await runtime.setVariable({
    name: "AWS_REGION",
    repo: "owner/repo",
    value: "ap-northeast-1",
  });

  assert.deepEqual(spawnCalls[0], {
    command: "gh",
    args: ["secret", "set", "AWS_ACCESS_KEY_ID", "--repo", "owner/repo"],
    input: "AKIA_TEST\n",
    options: { cwd: "/repo", env: { PATH: "/bin" } },
  });
  assert.deepEqual(execCalls[0], {
    command: "gh",
    args: [
      "variable", "set", "AWS_REGION", "--repo", "owner/repo",
      "--body", "ap-northeast-1",
    ],
    options: { cwd: "/repo", maxBuffer: 20 * 1024 * 1024 },
  });
});
