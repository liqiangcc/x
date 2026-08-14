"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { runDoctorCommand } = require("../src/adapters/cli/commands/doctor");

function captureStream() {
  let value = "";
  return {
    stream: { write(chunk) { value += String(chunk); } },
    read() { return value; },
  };
}

test("runDoctorCommand preserves successful doctor output contract", async () => {
  const stdout = captureStream();
  const stderr = captureStream();
  const exitCodes = [];
  const result = {
    checks: [
      { name: "node", ok: true, output: "v22.14.0" },
      { name: "git", ok: true, output: "git version 2.43.0" },
    ],
    failedCount: 0,
    runtime: { nodeVersion: "22.14.0", requiredNodeMajor: 22, supported: true },
  };

  const returned = await runDoctorCommand({
    useCase: { async execute() { return result; } },
    stdout: stdout.stream,
    stderr: stderr.stream,
    setExitCode(code) { exitCodes.push(code); },
  });

  assert.equal(returned, result);
  assert.equal(stdout.read(), "node: v22.14.0\ngit: git version 2.43.0\n");
  assert.equal(stderr.read(), "");
  assert.deepEqual(exitCodes, []);
});

test("runDoctorCommand preserves failure and Node compatibility semantics", async () => {
  const stdout = captureStream();
  const stderr = captureStream();
  const exitCodes = [];

  await runDoctorCommand({
    useCase: {
      async execute() {
        return {
          checks: [
            { name: "node", ok: true, output: "v20.19.0" },
            { name: "git", ok: false, error: "spawn git ENOENT" },
          ],
          failedCount: 1,
          runtime: { nodeVersion: "20.19.0", requiredNodeMajor: 22, supported: false },
        };
      },
    },
    stdout: stdout.stream,
    stderr: stderr.stream,
    setExitCode(code) { exitCodes.push(code); },
  });

  assert.equal(stdout.read(), "node: v20.19.0\n");
  assert.equal(
    stderr.read(),
    "git: missing or failed (spawn git ENOENT)\nnode: v20.19.0 detected; Node 22+ is required for SQLite commands.\n"
  );
  assert.deepEqual(exitCodes, [1]);
});

test("Node version warning alone does not change doctor exit code", async () => {
  const stderr = captureStream();
  const exitCodes = [];
  await runDoctorCommand({
    useCase: {
      async execute() {
        return {
          checks: [],
          failedCount: 0,
          runtime: { nodeVersion: "20.0.0", requiredNodeMajor: 22, supported: false },
        };
      },
    },
    stdout: captureStream().stream,
    stderr: stderr.stream,
    setExitCode(code) { exitCodes.push(code); },
  });

  assert.match(stderr.read(), /Node 22\+ is required/);
  assert.deepEqual(exitCodes, []);
});
