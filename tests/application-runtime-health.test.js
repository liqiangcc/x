"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CheckRuntimeHealthUseCase,
  normalizeNodeVersion,
} = require("../src/application/operations/check_runtime_health");

test("CheckRuntimeHealthUseCase reports successful tool probes deterministically", async () => {
  const calls = [];
  const outputs = {
    node: "v22.14.0\n",
    git: "git version 2.43.0\n",
  };
  const useCase = new CheckRuntimeHealthUseCase({
    runtimeNodeVersion: "22.14.0",
    async runTool({ name, args }) {
      calls.push({ name, args });
      return { stdout: outputs[name] };
    },
  });

  const result = await useCase.execute();

  assert.deepEqual(calls, [
    { name: "node", args: ["--version"] },
    { name: "git", args: ["--version"] },
  ]);
  assert.deepEqual(result.checks, [
    { name: "node", ok: true, output: "v22.14.0" },
    { name: "git", ok: true, output: "git version 2.43.0" },
  ]);
  assert.equal(result.failedCount, 0);
  assert.deepEqual(result.runtime, {
    nodeVersion: "22.14.0",
    requiredNodeMajor: 22,
    supported: true,
  });
});

test("CheckRuntimeHealthUseCase separates probe failures from runtime version compatibility", async () => {
  const useCase = new CheckRuntimeHealthUseCase({
    runtimeNodeVersion: "20.19.0",
    async runTool({ name }) {
      if (name === "git") throw new Error("git not found");
      return { stdout: "v20.19.0\n" };
    },
  });

  const result = await useCase.execute();

  assert.equal(result.failedCount, 1);
  assert.deepEqual(result.checks[1], {
    name: "git",
    ok: false,
    error: "git not found",
  });
  assert.equal(result.runtime.supported, false);
});

test("CheckRuntimeHealthUseCase validates injected capabilities and node version", () => {
  assert.throws(() => new CheckRuntimeHealthUseCase(), /runTool/);
  assert.throws(
    () => new CheckRuntimeHealthUseCase({ runTool() {}, runtimeNodeVersion: "invalid" }),
    /runtimeNodeVersion/
  );
  assert.equal(normalizeNodeVersion("v22.1.0"), "22.1.0");
});
