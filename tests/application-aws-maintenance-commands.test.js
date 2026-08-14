"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CheckAwsMaintenanceStatusUseCase,
  SyncAwsGitHubSettingsUseCase,
} = require("../src/application/aws/maintenance_commands");

function createReader(overrides = {}) {
  const calls = [];
  const reader = {
    async getToolVersion(command, args) {
      calls.push(["tool", command, args]);
      return { ok: true, version: `${command}-version` };
    },
    async readCredentials(profile) {
      calls.push(["credentials", profile]);
      return {
        accessKeyId: "AKIA_TEST",
        secretAccessKey: "secret-value",
        sessionToken: "",
      };
    },
    async getIdentity(profile) {
      calls.push(["identity", profile]);
      return { account: "123", arn: "arn:test", user_id: "user" };
    },
    async runKlinePreflight(options) {
      calls.push(["preflight", options]);
      return {
        ok: true,
        code: "600519",
        points: 2,
        source_engine: "aws",
        source_region: "ap-northeast-1",
      };
    },
    ...overrides,
  };
  reader.calls = calls;
  return reader;
}

test("aws status use case preserves successful diagnostic shape", async () => {
  const reader = createReader();
  const useCase = new CheckAwsMaintenanceStatusUseCase({ maintenanceReader: reader });

  const result = await useCase.execute({
    profile: "default",
    region: "ap-northeast-1",
    preflightRegion: "ap-northeast-1,ap-northeast-2",
    lambdaName: "kline",
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.summary, {
    profile: "default",
    region: "ap-northeast-1",
    preflight_region: "ap-northeast-1,ap-northeast-2",
    lambda_name: "kline",
    tools: {
      aws: { ok: true, version: "aws-version" },
      gh: { ok: true, version: "gh-version" },
    },
    credentials: {
      ok: true,
      access_key_id_present: true,
      secret_access_key_present: true,
      session_token_present: false,
    },
    identity: {
      ok: true,
      account: "123",
      arn: "arn:test",
      user_id: "user",
    },
    lambda_preflight: {
      ok: true,
      code: "600519",
      points: 2,
      source_engine: "aws",
      source_region: "ap-northeast-1",
    },
    status: "ok",
  });
});

test("aws status reports missing aws CLI without resolving credentials or preflight", async () => {
  const reader = createReader({
    async getToolVersion(command, args) {
      reader.calls.push(["tool", command, args]);
      if (command === "aws") return { ok: false, error: "missing" };
      return { ok: true, version: "gh-version" };
    },
  });
  const useCase = new CheckAwsMaintenanceStatusUseCase({ maintenanceReader: reader });

  const result = await useCase.execute({});

  assert.equal(result.exitCode, 1);
  assert.equal(result.summary.status, "failed");
  assert.deepEqual(result.summary.credentials, {
    ok: false,
    error: "aws CLI is unavailable.",
  });
  assert.deepEqual(result.summary.identity, {
    ok: false,
    error: "aws CLI is unavailable.",
  });
  assert.deepEqual(result.summary.lambda_preflight, {
    ok: false,
    error: "Static AWS profile credentials are required before Lambda preflight.",
  });
  assert.equal(reader.calls.some(([kind]) => kind === "credentials"), false);
  assert.equal(reader.calls.some(([kind]) => kind === "identity"), false);
  assert.equal(reader.calls.some(([kind]) => kind === "preflight"), false);
});

test("aws status keeps identity diagnostics when credentials fail and skips preflight", async () => {
  const reader = createReader({
    async readCredentials(profile) {
      reader.calls.push(["credentials", profile]);
      const error = new Error("credential failure");
      error.stderr = " credential   failure ";
      throw error;
    },
  });
  const useCase = new CheckAwsMaintenanceStatusUseCase({ maintenanceReader: reader });

  const result = await useCase.execute({});

  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.summary.credentials, {
    ok: false,
    error: "credential failure",
  });
  assert.equal(result.summary.identity.ok, true);
  assert.equal(reader.calls.some(([kind]) => kind === "identity"), true);
  assert.equal(reader.calls.some(([kind]) => kind === "preflight"), false);
});

test("sync github settings validates maintenance context before writing secrets", async () => {
  const reader = createReader();
  const writes = [];
  const writer = {
    async resolveRepository(repo) {
      writes.push(["repo", repo]);
      return repo ?? "owner/repo";
    },
    async setSecret(input) {
      writes.push(["secret", input]);
    },
    async setVariable(input) {
      writes.push(["variable", input]);
    },
  };
  const useCase = new SyncAwsGitHubSettingsUseCase({
    maintenanceReader: reader,
    githubSettingsWriter: writer,
  });

  const result = await useCase.execute({
    profile: "default",
    region: "ap-northeast-2",
    repo: "owner/repo",
  });

  assert.deepEqual(writes, [
    ["repo", "owner/repo"],
    ["secret", { name: "AWS_ACCESS_KEY_ID", repo: "owner/repo", value: "AKIA_TEST" }],
    ["secret", { name: "AWS_SECRET_ACCESS_KEY", repo: "owner/repo", value: "secret-value" }],
    ["variable", { name: "AWS_REGION", repo: "owner/repo", value: "ap-northeast-2" }],
  ]);
  assert.deepEqual(result.github, {
    secrets: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
    variables: ["AWS_REGION"],
  });
  assert.equal(JSON.stringify(result).includes("secret-value"), false);
  assert.equal(JSON.stringify(result).includes("AKIA_TEST"), false);
});

test("sync github settings does not write when required tool or preflight fails", async () => {
  const writes = [];
  const writer = {
    async resolveRepository(repo) {
      writes.push(["repo", repo]);
      return "owner/repo";
    },
    async setSecret(input) {
      writes.push(["secret", input]);
    },
    async setVariable(input) {
      writes.push(["variable", input]);
    },
  };

  const missingGh = createReader({
    async getToolVersion(command, args) {
      missingGh.calls.push(["tool", command, args]);
      return command === "gh"
        ? { ok: false, error: "gh missing" }
        : { ok: true, version: "aws-version" };
    },
  });
  await assert.rejects(
    () => new SyncAwsGitHubSettingsUseCase({
      maintenanceReader: missingGh,
      githubSettingsWriter: writer,
    }).execute({}),
    /gh CLI is not available: gh missing/
  );
  assert.deepEqual(writes, []);

  const badPreflight = createReader({
    async runKlinePreflight(options) {
      badPreflight.calls.push(["preflight", options]);
      return { ok: false, error: "probe failed" };
    },
  });
  await assert.rejects(
    () => new SyncAwsGitHubSettingsUseCase({
      maintenanceReader: badPreflight,
      githubSettingsWriter: writer,
    }).execute({}),
    /AWS kline preflight failed: probe failed/
  );
  assert.deepEqual(writes, []);
});
