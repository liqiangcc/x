"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createRunCommand,
  runRunCommand,
} = require("../src/adapters/cli/commands/run");

function captureWriter() {
  let text = "";
  return {
    stream: {
      write(chunk) {
        text += String(chunk);
      },
    },
    value() {
      return text;
    },
  };
}

test("run list delegates to Application and prints one run id per line", async () => {
  const output = captureWriter();
  let readCalled = false;
  const result = await runRunCommand({
    argv: ["list"],
    listRunsUseCase: {
      async execute() {
        return ["run-a", "run-b"];
      },
    },
    readRunArtifactUseCase: {
      async execute() {
        readCalled = true;
        return "";
      },
    },
    stdout: output.stream,
  });

  assert.equal(output.value(), "run-a\nrun-b\n");
  assert.equal(readCalled, false);
  assert.deepEqual(result.runIds, ["run-a", "run-b"]);
});

test("run show and failures translate CLI subcommands to controlled artifacts", async () => {
  const calls = [];
  const output = captureWriter();
  const common = {
    listRunsUseCase: { async execute() { return []; } },
    readRunArtifactUseCase: {
      async execute(input) {
        calls.push(input);
        return `${input.artifact}:${input.runId}\n`;
      },
    },
    stdout: output.stream,
  };

  await runRunCommand({ ...common, argv: ["show", "run-a"] });
  await runRunCommand({ ...common, argv: ["failures", "run-b"] });

  assert.deepEqual(calls, [
    { artifact: "run", runId: "run-a" },
    { artifact: "failures", runId: "run-b" },
  ]);
  assert.equal(output.value(), "run:run-a\nfailures:run-b\n");
});

test("run command preserves the legacy missing-run-id error contract", async () => {
  await assert.rejects(
    () => runRunCommand({
      argv: ["show"],
      listRunsUseCase: { async execute() { return []; } },
      readRunArtifactUseCase: { async execute() { return ""; } },
    }),
    /run show requires <run_id>/
  );
});

test("createRunCommand composes separate narrow run readers without filesystem dependencies", async () => {
  const output = captureWriter();
  const reads = [];
  const command = createRunCommand({
    runListReader: {
      async listRunIds() {
        return ["run-b", "run-a"];
      },
    },
    runArtifactReader: {
      async readArtifact(input) {
        reads.push(input);
        return "artifact\n";
      },
    },
    stdout: output.stream,
  });

  await command(["list"]);
  await command(["show", "run-a"]);

  assert.equal(output.value(), "run-a\nrun-b\nartifact\n");
  assert.deepEqual(reads, [{ artifact: "run", runId: "run-a" }]);
});
