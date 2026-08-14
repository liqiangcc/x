"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createGitDataCli,
  parseGitOptions,
  runCommitData,
  runGitCommand,
} = require("../src/adapters/cli/commands/git");

function outputBuffer() {
  let text = "";
  return {
    stream: { write(chunk) { text += String(chunk); } },
    text: () => text,
  };
}

test("git status-data writes raw status output", async () => {
  const output = outputBuffer();
  const result = await runGitCommand({
    argv: ["status-data"],
    statusDataUseCase: {
      async execute() { return " M data/sample.json\n"; },
    },
    stdout: output.stream,
  });

  assert.equal(result, " M data/sample.json\n");
  assert.equal(output.text(), result);
});

test("git commit-data preserves run-id mapping and no-data messages", async () => {
  const calls = [];
  const output = outputBuffer();
  const commitDataUseCase = {
    async execute(input) {
      calls.push(input);
      return calls.length === 1
        ? { status: "no-data-paths" }
        : { status: "no-data-changes" };
    },
  };

  await runGitCommand({
    argv: ["commit-data", "--run-id", "run-1"],
    commitDataUseCase,
    stdout: output.stream,
  });
  await runCommitData({
    commitDataUseCase,
    runId: "run-2",
    stdout: output.stream,
  });

  assert.deepEqual(calls, [{ runId: "run-1" }, { runId: "run-2" }]);
  assert.equal(
    output.text(),
    "No data paths to commit.\nNo data changes to commit.\n"
  );
});

test("git commit-data emits no success output", async () => {
  const output = outputBuffer();
  const result = await runGitCommand({
    argv: ["commit-data", "--run-id", "run-1"],
    commitDataUseCase: {
      async execute() { return { status: "committed" }; },
    },
    stdout: output.stream,
  });

  assert.deepEqual(result, { status: "committed" });
  assert.equal(output.text(), "");
});

test("git CLI preserves parser, missing run-id, and unknown-command semantics", async () => {
  assert.deepEqual(
    parseGitOptions(["--run-id", "run-1", "tail"]),
    { _: ["tail"], runId: "run-1" }
  );

  await assert.rejects(
    runGitCommand({ argv: ["commit-data"] }),
    /git commit-data requires --run-id <run_id>/
  );
  await assert.rejects(
    runGitCommand({ argv: ["unknown", "--dangling"] }),
    /Unknown git command: unknown/
  );
});

test("createGitDataCli keeps dependencies lazy for protocol-only failures", async () => {
  const cli = createGitDataCli();
  await assert.rejects(
    cli.command(["commit-data"]),
    /git commit-data requires --run-id <run_id>/
  );
  await assert.rejects(
    cli.command(["unknown"]),
    /Unknown git command: unknown/
  );
});

test("createGitDataCli shares commit operation between git command and daily-compatible runner", async () => {
  const calls = [];
  const output = outputBuffer();
  const cli = createGitDataCli({
    commitDataUseCase: {
      async execute(input) {
        calls.push(input);
        return { status: "committed" };
      },
    },
    stdout: output.stream,
  });

  await cli.command(["commit-data", "--run-id", "run-1"]);
  await cli.commitData("run-2");
  assert.deepEqual(calls, [{ runId: "run-1" }, { runId: "run-2" }]);
  assert.equal(output.text(), "");
});
