"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createAwsLatencyCommand,
  parseAwsLatencyOptions,
  runAwsLatencyCommand,
} = require("../src/adapters/cli/commands/aws_latency");

function captureStream() {
  let text = "";
  return {
    stream: { write(value) { text += String(value); } },
    text() { return text; },
  };
}

function sampleReport() {
  return {
    attempts: 1,
    engine: "aws",
    lmt: 1,
    period: "daily",
    secid: "1.600519",
    summary: {
      aws: {
        regions: {
          "ap-northeast-1": {
            attempts: 1,
            avg_ms: 10,
            max_ms: 10,
            min_ms: 10,
            p50_ms: 10,
            p95_ms: 10,
            successes: 1,
          },
        },
      },
    },
  };
}

test("aws latency parser preserves shared CLI token semantics", () => {
  assert.deepEqual(
    parseAwsLatencyOptions([
      "--engine", "aws-router",
      "--target-region", "all",
      "--router-mode", "probe",
      "--json",
      "--output", "runs/latency.json",
    ]),
    {
      _: [],
      engine: "aws-router",
      targetRegion: "all",
      routerMode: "probe",
      json: true,
      output: "runs/latency.json",
    }
  );
});

test("aws latency CLI keeps presentation flags out of the application request and prints JSON", async () => {
  const output = captureStream();
  const report = sampleReport();
  let request;

  await runAwsLatencyCommand({
    argv: [
      "--config", "config/custom.json",
      "--output", "runs/result.json",
      "--engine", "aws",
      "--attempts", "2",
      "--json",
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
    config: "config/custom.json",
    output: "runs/result.json",
    options: { attempts: "2", engine: "aws" },
  });
  assert.equal(output.text(), `${JSON.stringify(report, null, 2)}\n`);
});

test("aws latency CLI preserves the existing text report format", async () => {
  const output = captureStream();
  await runAwsLatencyCommand({
    argv: ["--engine", "aws"],
    stdout: output.stream,
    useCase: { async execute() { return sampleReport(); } },
  });

  assert.equal(
    output.text(),
    [
      "Latency benchmark 1.600519 daily lmt=1 attempts=1",
      "engine\tregion\tsuccess\tavg_ms\tp50_ms\tp95_ms\tmin_ms\tmax_ms",
      "aws\tap-northeast-1\t1/1\t10\t10\t10\t10\t10",
      "",
    ].join("\n")
  );
});

test("aws latency CLI parses protocol errors before resolving infrastructure", async () => {
  let resolutions = 0;
  await assert.rejects(
    () => runAwsLatencyCommand({
      argv: ["--attempts"],
      getUseCase() {
        resolutions += 1;
        return { execute() {} };
      },
    }),
    /Missing value for --attempts/
  );
  assert.equal(resolutions, 0);
});

test("aws latency factory accepts an explicit use case without constructing defaults", async () => {
  const output = captureStream();
  const command = createAwsLatencyCommand({
    stdout: output.stream,
    useCase: { async execute() { return sampleReport(); } },
  });

  await command(["--json"]);
  assert.match(output.text(), /"engine": "aws"/);
});
