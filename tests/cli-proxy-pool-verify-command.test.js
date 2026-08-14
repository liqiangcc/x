"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createProxyPoolVerifyCommand,
  parseProxyPoolVerifyOptions,
  runProxyPoolVerifyCommand,
} = require("../src/adapters/cli/commands/proxy_pool_verify");

function captureStream() {
  let text = "";
  return {
    stream: { write(value) { text += String(value); } },
    text() { return text; },
  };
}

function sampleReport(availableCount = 1) {
  return {
    available_count: availableCount,
    available: availableCount > 0 ? [{ proxy: "1.1.1.1:80" }] : [],
    files: {
      report: "runs/proxy-verify/run/report.json",
      available: "runs/proxy-verify/run/available.txt",
    },
  };
}

test("proxy pool verify parser preserves shared CLI token semantics", () => {
  assert.deepEqual(
    parseProxyPoolVerifyOptions([
      "--concurrency", "4",
      "--timeout-ms", "5000",
      "--limit", "10",
      "--output", "custom/report.json",
      "ignored",
    ]),
    {
      _: ["ignored"],
      concurrency: "4",
      timeoutMs: "5000",
      limit: "10",
      output: "custom/report.json",
    }
  );
});

test("proxy pool verify CLI normalizes protocol options and prints exact JSON", async () => {
  const output = captureStream();
  let request;
  const report = sampleReport(1);

  await runProxyPoolVerifyCommand({
    argv: [
      "--concurrency", "4",
      "--timeout-ms", "5000",
      "--limit", "10",
      "--output", "custom/report.json",
    ],
    stdout: output.stream,
    useCase: {
      async execute(value) {
        request = value;
        return report;
      },
    },
  });

  assert.deepEqual(request, {
    concurrency: 4,
    timeoutMs: 5000,
    limit: 10,
    output: "custom/report.json",
  });
  assert.equal(output.text(), `${JSON.stringify(report, null, 2)}\n`);
});

test("proxy pool verify CLI preserves defaults and zero-availability exit code", async () => {
  const output = captureStream();
  const exitCodes = [];
  let request;

  await runProxyPoolVerifyCommand({
    argv: [],
    stdout: output.stream,
    setExitCode(code) {
      exitCodes.push(code);
    },
    useCase: {
      async execute(value) {
        request = value;
        return sampleReport(0);
      },
    },
  });

  assert.deepEqual(request, {
    concurrency: 8,
    timeoutMs: 6000,
    output: null,
  });
  assert.deepEqual(exitCodes, [2]);
});

test("proxy pool verify CLI preserves exact positive-integer validation", async () => {
  await assert.rejects(
    () => runProxyPoolVerifyCommand({
      argv: ["--concurrency", "0"],
      useCase: { execute() {} },
    }),
    /--concurrency must be a positive integer\./
  );
  await assert.rejects(
    () => runProxyPoolVerifyCommand({
      argv: ["--timeout-ms", "x"],
      useCase: { execute() {} },
    }),
    /--timeout-ms must be a positive integer\./
  );
  await assert.rejects(
    () => runProxyPoolVerifyCommand({
      argv: ["--limit", "-1"],
      useCase: { execute() {} },
    }),
    /--limit must be a positive integer\./
  );
});

test("proxy pool verify CLI parses protocol failures before resolving infrastructure", async () => {
  let resolutions = 0;
  await assert.rejects(
    () => runProxyPoolVerifyCommand({
      argv: ["--timeout-ms"],
      getUseCase() {
        resolutions += 1;
        return { execute() {} };
      },
    }),
    /Missing value for --timeout-ms/
  );
  assert.equal(resolutions, 0);
});

test("proxy pool verify factory accepts an explicit use case without constructing defaults", async () => {
  const output = captureStream();
  const command = createProxyPoolVerifyCommand({
    stdout: output.stream,
    useCase: { async execute() { return sampleReport(1); } },
  });

  await command([]);
  assert.match(output.text(), /"available_count": 1/);
});
