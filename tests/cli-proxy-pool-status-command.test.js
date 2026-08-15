"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  runProxyPoolStatusCommand,
} = require("../src/adapters/cli/commands/proxy_pool_status");

test("proxy pool status preserves compose output before JSON presentation", async () => {
  const writes = [];
  const report = { ok: true, cn_candidates: 9 };
  const result = await runProxyPoolStatusCommand({
    argv: [],
    useCase: {
      async execute() {
        return {
          runtime: { stdout: "compose output\n", stderr: "compose warning\n" },
          report,
          exitCode: 0,
        };
      },
    },
    stdout: { write: (value) => writes.push(["stdout", value]) },
    stderr: { write: (value) => writes.push(["stderr", value]) },
  });

  assert.deepEqual(result, report);
  assert.deepEqual(writes, [
    ["stdout", "compose output\n"],
    ["stderr", "compose warning\n"],
    ["stdout", `${JSON.stringify(report, null, 2)}\n`],
  ]);
});

test("proxy pool status propagates diagnostic exit code", async () => {
  const exitCodes = [];
  let stdout = "";
  const report = { ok: false, error: "offline", cn_candidates: 0 };
  await runProxyPoolStatusCommand({
    useCase: {
      async execute() {
        return { runtime: { stdout: "", stderr: "" }, report, exitCode: 1 };
      },
    },
    stdout: { write: (value) => { stdout += value; } },
    stderr: { write() {} },
    setExitCode: (code) => exitCodes.push(code),
  });

  assert.deepEqual(exitCodes, [1]);
  assert.equal(stdout, `${JSON.stringify(report, null, 2)}\n`);
});

test("proxy pool status parser failures happen before use case resolution", async () => {
  let infrastructureCalls = 0;
  await assert.rejects(
    () => runProxyPoolStatusCommand({
      argv: ["--unexpected"],
      getUseCase() {
        infrastructureCalls += 1;
        return { execute() {} };
      },
    }),
    /Missing value for --unexpected/
  );
  assert.equal(infrastructureCalls, 0);
});

test("proxy pool status still accepts ignored parsed options like legacy CLI", async () => {
  let calls = 0;
  await runProxyPoolStatusCommand({
    argv: ["--unused", "value", "--json"],
    useCase: {
      async execute() {
        calls += 1;
        return {
          runtime: { stdout: "", stderr: "" },
          report: { ok: true, cn_candidates: 0 },
          exitCode: 0,
        };
      },
    },
    stdout: { write() {} },
    stderr: { write() {} },
  });
  assert.equal(calls, 1);
});
