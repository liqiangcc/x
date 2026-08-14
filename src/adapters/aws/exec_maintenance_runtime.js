"use strict";

const path = require("node:path");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const {
  awsProfileEnv,
  buildGithubSecretSetArgs,
  buildGithubVariableSetArgs,
  getAwsCallerIdentity,
  getToolVersion,
  readAwsProfileCredentials,
  resolveGitHubRepo,
  sanitizeError,
} = require("../../aws/maintenance");

function runCommandWithInput(command, args, input, { cwd, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error(`${command} ${args.join(" ")} failed with exit code ${code ?? 1}`);
      error.code = code ?? 1;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });

    child.stdin.end(input);
  });
}

function createExecAwsMaintenanceRuntime({
  root,
  env = process.env,
  execFileImpl = execFile,
  spawnCommand = runCommandWithInput,
} = {}) {
  const execFileAsync = promisify(execFileImpl);

  async function runKlinePreflight({ profile, preflightRegion, lambdaName }) {
    const args = [
      "600519",
      "--period",
      "daily",
      "--engine",
      "aws",
      "--lambda-name",
      lambdaName,
    ];
    if (preflightRegion) args.push("--aws-region", preflightRegion);

    let result;
    try {
      const { stdout = "", stderr = "" } = await execFileAsync(
        "node",
        [path.join(root, "fetch", "fetch_kline.js"), ...args],
        {
          cwd: root,
          env: awsProfileEnv(profile, {
            ...env,
            NODE_NO_WARNINGS: "1",
          }),
          maxBuffer: 50 * 1024 * 1024,
        }
      );
      result = { stdout, stderr, exitCode: 0 };
    } catch (error) {
      result = {
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? error.message,
        exitCode: typeof error.code === "number" ? error.code : 1,
      };
    }

    if (result.exitCode !== 0) {
      return {
        ok: false,
        error: sanitizeError({
          stderr: result.stderr || result.stdout || "AWS kline preflight failed.",
        }),
      };
    }

    try {
      const payload = JSON.parse(result.stdout);
      const klines = Array.isArray(payload?.data?.klines)
        ? payload.data.klines
        : Array.isArray(payload?.klines)
          ? payload.klines
          : [];
      return {
        ok: true,
        code: payload?.data?.code ?? payload?.code ?? "600519",
        points: klines.length,
        source_engine: payload?.source_engine ?? null,
        source_region: payload?.source_region ?? null,
      };
    } catch (error) {
      return {
        ok: false,
        error: `Failed to parse AWS kline preflight output: ${error.message}`,
      };
    }
  }

  return {
    getToolVersion(command, args) {
      return getToolVersion(command, args, execFileAsync);
    },
    readCredentials(profile) {
      return readAwsProfileCredentials({ profile, execFileAsync });
    },
    getIdentity(profile) {
      return getAwsCallerIdentity({ profile, execFileAsync });
    },
    runKlinePreflight,
    resolveRepository(repo) {
      return resolveGitHubRepo({ repo, execFileAsync, cwd: root });
    },
    setSecret({ name, repo, value }) {
      return spawnCommand(
        "gh",
        buildGithubSecretSetArgs(name, repo),
        `${value}\n`,
        { cwd: root, env }
      );
    },
    setVariable({ name, repo, value }) {
      return execFileAsync(
        "gh",
        buildGithubVariableSetArgs(name, value, repo),
        { cwd: root, maxBuffer: 20 * 1024 * 1024 }
      );
    },
  };
}

module.exports = {
  createExecAwsMaintenanceRuntime,
  runCommandWithInput,
};
