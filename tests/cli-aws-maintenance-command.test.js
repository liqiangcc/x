"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createAwsMaintenanceCommand,
  parseAwsMaintenanceOptions,
  runAwsMaintenanceCommand,
} = require("../src/adapters/cli/commands/aws_maintenance");

function captureStream() {
  let value = "";
  return {
    stream: { write(chunk) { value += String(chunk); } },
    read() { return value; },
  };
}

test("aws maintenance CLI reuses shared option parser", () => {
  assert.deepEqual(parseAwsMaintenanceOptions([
    "--profile", "dev",
    "--preflight-region", "r1,r2",
    "--lambda-name", "custom",
    "--repo", "owner/repo",
  ]), {
    _: [],
    profile: "dev",
    preflightRegion: "r1,r2",
    lambdaName: "custom",
    repo: "owner/repo",
  });
});

test("aws status CLI prints diagnostic JSON and propagates exit code", async () => {
  const output = captureStream();
  const exits = [];
  const calls = [];
  const statusUseCase = {
    async execute(options) {
      calls.push(options);
      return {
        exitCode: 1,
        summary: { status: "failed", profile: options.profile },
      };
    },
  };

  const result = await runAwsMaintenanceCommand({
    argv: ["status", "--profile", "dev"],
    statusUseCase,
    stdout: output.stream,
    setExitCode: (code) => exits.push(code),
  });

  assert.deepEqual(calls, [{ _: [], profile: "dev" }]);
  assert.deepEqual(exits, [1]);
  assert.equal(output.read(), `${JSON.stringify(result.summary, null, 2)}\n`);
});

test("aws sync-github-secrets CLI prints successful JSON without setting exit code", async () => {
  const output = captureStream();
  const exits = [];
  const calls = [];
  const syncUseCase = {
    async execute(options) {
      calls.push(options);
      return { status: "ok", repo: options.repo };
    },
  };

  const result = await runAwsMaintenanceCommand({
    argv: ["sync-github-secrets", "--repo", "owner/repo"],
    syncUseCase,
    stdout: output.stream,
    setExitCode: (code) => exits.push(code),
  });

  assert.deepEqual(calls, [{ _: [], repo: "owner/repo" }]);
  assert.deepEqual(exits, []);
  assert.equal(output.read(), `${JSON.stringify(result, null, 2)}\n`);
});

test("aws maintenance command keeps infrastructure lazy for unknown subcommands", async () => {
  const command = createAwsMaintenanceCommand({ root: "/does/not/matter" });
  await assert.rejects(
    () => command(["latency", "--json"]),
    /Unknown aws command: latency/
  );
});

test("aws maintenance factory accepts narrow injected capabilities independently", async () => {
  const output = captureStream();
  const maintenanceReader = {
    async getToolVersion(command) {
      return { ok: true, version: `${command}-version` };
    },
    async readCredentials() {
      return { accessKeyId: "a", secretAccessKey: "b", sessionToken: "" };
    },
    async getIdentity() {
      return { account: "1", arn: "arn", user_id: "u" };
    },
    async runKlinePreflight() {
      return { ok: true, code: "600519", points: 1, source_engine: "aws", source_region: null };
    },
  };
  const githubSettingsWriter = {
    async resolveRepository(repo) { return repo; },
    async setSecret() {},
    async setVariable() {},
  };
  const command = createAwsMaintenanceCommand({
    root: "/repo",
    stdout: output.stream,
    maintenanceReader,
    githubSettingsWriter,
  });

  await command(["sync-github-secrets", "--repo", "owner/repo"]);
  assert.match(output.read(), /"repo": "owner\/repo"/);
});
