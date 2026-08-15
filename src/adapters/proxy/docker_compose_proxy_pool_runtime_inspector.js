"use strict";

const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");

function createDockerComposeProxyPoolRuntimeInspector({
  root,
  fsAccess = fs.access,
  execFileAsync = promisify(execFile),
} = {}) {
  const resolvedRoot = root ?? process.cwd();
  const composeDir = path.join(resolvedRoot, "ops", "proxy-pool");
  const envFile = path.join(composeDir, ".env");
  const composeFile = path.join(composeDir, "compose.yml");

  return {
    async inspect() {
      try {
        await fsAccess(envFile);
      } catch {
        throw new Error(
          "Missing ops/proxy-pool/.env; copy .env.example and set PROXY_POOL_API_KEY first."
        );
      }

      const result = await execFileAsync(
        "docker",
        ["compose", "--env-file", envFile, "-f", composeFile, "ps"],
        { cwd: resolvedRoot, maxBuffer: 20 * 1024 * 1024 }
      );
      return {
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      };
    },
  };
}

module.exports = {
  createDockerComposeProxyPoolRuntimeInspector,
};
