"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  composeArgsForAction,
  createProxyPoolLifecycleCommand,
  runProxyPoolLifecycleCommand,
} = require("../src/adapters/cli/commands/proxy_pool_lifecycle");

function outputSink() {
  let value = "";
  return {
    stream: {
      write(chunk) {
        value += String(chunk);
      },
    },
    value: () => value,
  };
}

test("proxy pool lifecycle maps up/down to the existing compose contract", async () => {
  assert.deepEqual(composeArgsForAction("up"), ["up", "-d", "--build"]);
  assert.deepEqual(composeArgsForAction("down"), ["down"]);

  const calls = [];
  const stdout = outputSink();
  const stderr = outputSink();
  const command = createProxyPoolLifecycleCommand({
    compose: {
      async run(args) {
        calls.push(args);
        return { stdout: `stdout:${args[0]}\n`, stderr: `stderr:${args[0]}\n` };
      },
    },
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  await command(["up"]);
  await command(["down"]);

  assert.deepEqual(calls, [
    ["up", "-d", "--build"],
    ["down"],
  ]);
  assert.equal(stdout.value(), "stdout:up\nstdout:down\n");
  assert.equal(stderr.value(), "stderr:up\nstderr:down\n");
});

test("proxy pool lifecycle validates CLI tokens before resolving compose infrastructure", async () => {
  let composeResolutions = 0;
  await assert.rejects(
    () => runProxyPoolLifecycleCommand({
      argv: ["up", "--unexpected"],
      getCompose() {
        composeResolutions += 1;
        return { run: async () => ({}) };
      },
    }),
    /Missing value for --unexpected/
  );
  assert.equal(composeResolutions, 0);
});

test("proxy pool lifecycle rejects unknown lifecycle actions before resolving compose", async () => {
  let composeResolutions = 0;
  await assert.rejects(
    () => runProxyPoolLifecycleCommand({
      argv: ["restart"],
      getCompose() {
        composeResolutions += 1;
        return { run: async () => ({}) };
      },
    }),
    /Unknown proxy pool lifecycle action: restart/
  );
  assert.equal(composeResolutions, 0);
});

test("proxy pool lifecycle preserves compose failures", async () => {
  const failure = new Error("docker unavailable");
  await assert.rejects(
    () => runProxyPoolLifecycleCommand({
      argv: ["down"],
      compose: {
        async run() {
          throw failure;
        },
      },
    }),
    (error) => error === failure
  );
});
