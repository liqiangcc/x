"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  MISSING_ENV_ERROR,
  createDockerComposeProxyPool,
} = require("../src/adapters/proxy/docker_compose_proxy_pool");

test("shared proxy compose capability preserves env, compose file, cwd and arbitrary args", async () => {
  const root = path.join(path.sep, "repo");
  const calls = [];
  const compose = createDockerComposeProxyPool({
    root,
    async fsAccess(filePath) {
      calls.push(["access", filePath]);
    },
    async execFileAsync(command, args, options) {
      calls.push(["exec", command, args, options]);
      return { stdout: "compose stdout\n", stderr: "compose stderr\n" };
    },
  });

  assert.deepEqual(await compose.run(["up", "-d", "--build"]), {
    stdout: "compose stdout\n",
    stderr: "compose stderr\n",
  });
  assert.deepEqual(calls, [
    ["access", path.join(root, "ops", "proxy-pool", ".env")],
    [
      "exec",
      "docker",
      [
        "compose",
        "--env-file",
        path.join(root, "ops", "proxy-pool", ".env"),
        "-f",
        path.join(root, "ops", "proxy-pool", "compose.yml"),
        "up",
        "-d",
        "--build",
      ],
      { cwd: root, maxBuffer: 20 * 1024 * 1024 },
    ],
  ]);
});

test("shared proxy compose capability preserves the missing env contract and skips docker", async () => {
  let execCalls = 0;
  const compose = createDockerComposeProxyPool({
    root: path.join(path.sep, "repo"),
    async fsAccess() {
      throw new Error("missing");
    },
    async execFileAsync() {
      execCalls += 1;
      return {};
    },
  });

  await assert.rejects(() => compose.run(["down"]), (error) => {
    assert.equal(error.message, MISSING_ENV_ERROR);
    return true;
  });
  assert.equal(execCalls, 0);
});
