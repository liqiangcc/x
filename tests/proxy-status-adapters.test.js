"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  createDockerComposeProxyPoolRuntimeInspector,
} = require("../src/adapters/proxy/docker_compose_proxy_pool_runtime_inspector");
const {
  createProxyPoolCandidateCounter,
} = require("../src/adapters/proxy/proxy_pool_candidate_counter");

test("docker compose status inspector preserves command, cwd, env-file and output", async () => {
  const root = path.join(path.sep, "repo");
  const calls = [];
  const inspector = createDockerComposeProxyPoolRuntimeInspector({
    root,
    async fsAccess(filePath) {
      calls.push(["access", filePath]);
    },
    async execFileAsync(command, args, options) {
      calls.push(["exec", command, args, options]);
      return { stdout: "NAME STATUS\n", stderr: "warning\n" };
    },
  });

  assert.deepEqual(await inspector.inspect(), {
    stdout: "NAME STATUS\n",
    stderr: "warning\n",
  });
  assert.deepEqual(calls[0], [
    "access",
    path.join(root, "ops", "proxy-pool", ".env"),
  ]);
  assert.deepEqual(calls[1], [
    "exec",
    "docker",
    [
      "compose",
      "--env-file",
      path.join(root, "ops", "proxy-pool", ".env"),
      "-f",
      path.join(root, "ops", "proxy-pool", "compose.yml"),
      "ps",
    ],
    { cwd: root, maxBuffer: 20 * 1024 * 1024 },
  ]);
});

test("docker compose status inspector preserves missing env error and skips docker", async () => {
  let execCalls = 0;
  const inspector = createDockerComposeProxyPoolRuntimeInspector({
    root: path.join(path.sep, "repo"),
    async fsAccess() {
      throw new Error("missing");
    },
    async execFileAsync() {
      execCalls += 1;
      return {};
    },
  });

  await assert.rejects(
    () => inspector.inspect(),
    /Missing ops\/proxy-pool\/\.env; copy \.env\.example and set PROXY_POOL_API_KEY first\./
  );
  assert.equal(execCalls, 0);
});

test("proxy candidate counter delegates to existing candidate capability", async () => {
  let calls = 0;
  const counter = createProxyPoolCandidateCounter({
    async fetchAllProxyCandidatesImpl() {
      calls += 1;
      return ["a", "b", "c"];
    },
  });

  assert.equal(await counter.count(), 3);
  assert.equal(calls, 1);
});
