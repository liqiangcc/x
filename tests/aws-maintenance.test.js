"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  AWS_ACCESS_KEY_SECRET,
  AWS_SECRET_KEY_SECRET,
  awsProfileEnv,
  buildGithubSecretSetArgs,
  buildGithubVariableSetArgs,
  normalizeAwsOptions,
  parseGitHubRepo,
  readAwsProfileCredentials,
  resolveGitHubRepo,
} = require("../src/aws/maintenance");

function mockExecFile(responses) {
  const calls = [];
  const execFileAsync = async (command, args, options = {}) => {
    const key = [command, ...args].join(" ");
    calls.push({ command, args, options, key });
    const response = responses[key];
    if (!response) {
      const error = new Error(`Unexpected command: ${key}`);
      error.code = 1;
      throw error;
    }
    if (response.error) {
      throw response.error;
    }
    return {
      stdout: response.stdout ?? "",
      stderr: response.stderr ?? "",
    };
  };
  execFileAsync.calls = calls;
  return execFileAsync;
}

test("readAwsProfileCredentials reads long-lived profile credentials", async () => {
  const execFileAsync = mockExecFile({
    "aws configure get aws_access_key_id --profile default": { stdout: "AKIA_TEST\n" },
    "aws configure get aws_secret_access_key --profile default": { stdout: "secret-value\n" },
    "aws configure get aws_session_token --profile default": { stdout: "" },
  });

  assert.deepEqual(
    await readAwsProfileCredentials({ profile: "default", execFileAsync }),
    {
      accessKeyId: "AKIA_TEST",
      secretAccessKey: "secret-value",
      sessionToken: "",
    }
  );
});

test("readAwsProfileCredentials rejects temporary session-token credentials", async () => {
  const execFileAsync = mockExecFile({
    "aws configure get aws_access_key_id --profile default": { stdout: "AKIA_TEST\n" },
    "aws configure get aws_secret_access_key --profile default": { stdout: "secret-value\n" },
    "aws configure get aws_session_token --profile default": { stdout: "session-token\n" },
  });

  await assert.rejects(
    () => readAwsProfileCredentials({ profile: "default", execFileAsync }),
    /contains aws_session_token/
  );
});

test("parseGitHubRepo handles common GitHub origin URLs", () => {
  assert.equal(parseGitHubRepo("https://github.com/liqiangcc/x.git"), "liqiangcc/x");
  assert.equal(parseGitHubRepo("git@github.com:liqiangcc/x.git"), "liqiangcc/x");
  assert.equal(parseGitHubRepo("ssh://git@github.com/liqiangcc/x.git"), "liqiangcc/x");
  assert.equal(parseGitHubRepo("https://example.com/liqiangcc/x.git"), null);
});

test("resolveGitHubRepo infers owner/name from origin remote", async () => {
  const execFileAsync = mockExecFile({
    "git remote get-url origin": { stdout: "https://github.com/liqiangcc/x.git\n" },
  });

  assert.equal(
    await resolveGitHubRepo({ execFileAsync, cwd: "/repo" }),
    "liqiangcc/x"
  );
  assert.deepEqual(execFileAsync.calls[0].options, { cwd: "/repo" });
});

test("GitHub secret command builders do not include secret values", () => {
  assert.deepEqual(buildGithubSecretSetArgs(AWS_ACCESS_KEY_SECRET, "owner/repo"), [
    "secret",
    "set",
    "AWS_ACCESS_KEY_ID",
    "--repo",
    "owner/repo",
  ]);
  assert.deepEqual(buildGithubSecretSetArgs(AWS_SECRET_KEY_SECRET, "owner/repo"), [
    "secret",
    "set",
    "AWS_SECRET_ACCESS_KEY",
    "--repo",
    "owner/repo",
  ]);
  assert.deepEqual(buildGithubVariableSetArgs("AWS_REGION", "ap-northeast-1", "owner/repo"), [
    "variable",
    "set",
    "AWS_REGION",
    "--repo",
    "owner/repo",
    "--body",
    "ap-northeast-1",
  ]);
});

test("awsProfileEnv selects the requested local profile", () => {
  assert.deepEqual(awsProfileEnv("default", { PATH: "/bin" }), {
    PATH: "/bin",
    AWS_PROFILE: "default",
    AWS_SDK_LOAD_CONFIG: "1",
  });
});

test("normalizeAwsOptions separates default region from optional preflight region", () => {
  assert.deepEqual(normalizeAwsOptions({}), {
    profile: "default",
    region: "ap-northeast-1",
    preflightRegion: null,
    lambdaName: "kline",
  });
  assert.deepEqual(
    normalizeAwsOptions({
      profile: "default",
      region: "ap-northeast-1",
      preflightRegion: "ap-northeast-1,ap-northeast-2",
      lambdaName: "kline",
    }),
    {
      profile: "default",
      region: "ap-northeast-1",
      preflightRegion: "ap-northeast-1,ap-northeast-2",
      lambdaName: "kline",
    }
  );
});

test("daily workflow uses maintained AWS access key secrets", () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, "..", ".github", "workflows", "daily-data-commit.yml"),
    "utf8"
  );
  const latencyWorkflow = fs.readFileSync(
    path.join(__dirname, "..", ".github", "workflows", "latency-benchmark.yml"),
    "utf8"
  );
  const deployScript = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "deploy-aws-router.sh"),
    "utf8"
  );

  assert.equal(workflow.includes("id-token: write"), false);
  assert.equal(workflow.includes("AWS_ROLE_ARN"), false);
  assert.equal(workflow.includes('default: "aws-router"'), true);
  assert.equal(workflow.includes("github.event.inputs.engine == 'aws' || github.event.inputs.engine == 'auto'"), true);
  assert.equal(workflow.includes("github.event_name == 'schedule' || github.event.inputs.engine == ''"), false);
  assert.equal(workflow.includes("secrets.AWS_ACCESS_KEY_ID"), true);
  assert.equal(workflow.includes("secrets.AWS_SECRET_ACCESS_KEY"), true);
  assert.equal(workflow.includes("vars.AWS_REGION || 'ap-northeast-1'"), true);
  assert.equal(workflow.includes("- aws-router"), true);
  assert.equal(workflow.includes("secrets.AWS_ROUTER_URL"), true);
  assert.equal(workflow.includes("secrets.AWS_ROUTER_TOKEN"), true);
  assert.equal(workflow.includes("force_universe"), true);
  assert.equal(latencyWorkflow.includes("name: Latency Benchmark"), true);
  assert.equal(latencyWorkflow.includes("bin/x \"${args[@]}\""), true);
  assert.equal(latencyWorkflow.includes("latency-results.json"), true);
  assert.equal(latencyWorkflow.includes("secrets.AWS_ROUTER_URL"), true);
  assert.equal(latencyWorkflow.includes("secrets.AWS_ACCESS_KEY_ID"), true);
  assert.equal(deployScript.includes('TARGET_REGIONS="ap-northeast-1,ap-northeast-2,ap-southeast-1,us-west-2"'), true);
  assert.equal(deployScript.includes('ROUTER_MAX_FALLBACKS="4"'), true);
  assert.equal(deployScript.includes("ap-northeast-1,us-east-1,ap-northeast-2"), false);
});
