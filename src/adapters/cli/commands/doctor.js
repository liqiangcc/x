"use strict";

const {
  CheckRuntimeHealthUseCase,
} = require("../../../application/operations/check_runtime_health");
const { createExecToolProbe } = require("../../system/exec_tool_probe");

async function runDoctorCommand({
  useCase,
  stdout = process.stdout,
  stderr = process.stderr,
  setExitCode = (code) => { process.exitCode = code; },
} = {}) {
  if (!useCase || typeof useCase.execute !== "function") {
    throw new TypeError("doctor useCase must expose execute().");
  }

  const result = await useCase.execute();
  for (const check of result.checks) {
    if (check.ok) {
      stdout.write(`${check.name}: ${check.output}\n`);
    } else {
      stderr.write(`${check.name}: missing or failed (${check.error})\n`);
    }
  }

  if (!result.runtime.supported) {
    stderr.write(
      `node: v${result.runtime.nodeVersion} detected; Node ${result.runtime.requiredNodeMajor}+ is required for SQLite commands.\n`
    );
  }

  if (result.failedCount > 0) {
    setExitCode(1);
  }
  return result;
}

function createDoctorCommand({
  cwd,
  runtimeNodeVersion = process.versions.node,
  stdout = process.stdout,
  stderr = process.stderr,
  setExitCode = (code) => { process.exitCode = code; },
  useCase,
} = {}) {
  const resolvedUseCase = useCase ?? new CheckRuntimeHealthUseCase({
    runTool: createExecToolProbe({ cwd }),
    runtimeNodeVersion,
  });

  return () => runDoctorCommand({
    useCase: resolvedUseCase,
    stdout,
    stderr,
    setExitCode,
  });
}

module.exports = {
  createDoctorCommand,
  runDoctorCommand,
};
