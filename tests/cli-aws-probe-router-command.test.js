"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createAwsProbeRouterCommand,
  parseAwsProbeRouterOptions,
  runAwsProbeRouterCommand,
} = require("../src/adapters/cli/commands/aws_probe_router");

function captureStream() {
  let text = "";
  return {
    stream: { write(chunk) { text += String(chunk); } },
    text: () => text,
  };
}

test("aws probe-router CLI parses the shared option protocol", () => {
  assert.deepEqual(
    parseAwsProbeRouterOptions([
      "--secid", "600519",
      "--period", "yearly",
      "--target-region", "all",
      "--lmt", "2",
    ]),
    {
      _: [],
      secid: "600519",
      period: "yearly",
      targetRegion: "all",
      lmt: "2",
    }
  );
});

test("aws probe-router CLI validates required secid before resolving infrastructure", async () => {
  let resolved = false;
  await assert.rejects(
    () => runAwsProbeRouterCommand({
      argv: [],
      getProbeRouterUseCase() {
        resolved = true;
        throw new Error("must not resolve");
      },
    }),
    /aws probe-router requires --secid <secid_or_code>\./
  );
  assert.equal(resolved, false);
});

test("aws probe-router CLI maps options and prints exact pretty JSON", async () => {
  const output = captureStream();
  const calls = [];
  const payload = { ok: true, region: "ap-northeast-1" };
  const result = await runAwsProbeRouterCommand({
    argv: [
      "--secid", "600519",
      "--period", "daily",
      "--target-region", "ap-northeast-1",
      "--lmt", "3",
      "--end", "20261231",
    ],
    probeRouterUseCase: {
      async execute(request) {
        calls.push(request);
        return payload;
      },
    },
    stdout: output.stream,
  });

  assert.equal(result, payload);
  assert.deepEqual(calls, [{
    end: "20261231",
    lmt: "3",
    period: "daily",
    secid: "600519",
    targetRegion: "ap-northeast-1",
  }]);
  assert.equal(output.text(), `${JSON.stringify(payload, null, 2)}\n`);
});

test("aws probe-router composition accepts a narrow injected client", async () => {
  const output = captureStream();
  const calls = [];
  const command = createAwsProbeRouterCommand({
    routerProbeClient: {
      async probe(request) {
        calls.push(request);
        return { ok: true };
      },
    },
    stdout: output.stream,
  });

  await command(["--secid", "600519"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].secid, "1.600519");
  assert.equal(output.text(), "{\n  \"ok\": true\n}\n");
});
