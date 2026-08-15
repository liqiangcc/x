"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createProxyPoolSelectCommand,
  parseProxyPoolSelectOptions,
  runProxyPoolSelectCommand,
} = require("../src/adapters/cli/commands/proxy_pool_select");

function captureStream() {
  let text = "";
  return {
    stream: { write(value) { text += String(value); } },
    text() { return text; },
  };
}

test("proxy pool select parser preserves shared CLI token semantics", () => {
  assert.deepEqual(parseProxyPoolSelectOptions([
    "--min-samples", "6",
    "--min-success-rate", "0.9",
    "--max-p95-ms", "2500",
    "--limit", "3",
    "--output", "custom/selected.json",
  ]), {
    _: [],
    minSamples: "6",
    minSuccessRate: "0.9",
    maxP95Ms: "2500",
    limit: "3",
    output: "custom/selected.json",
  });
});

test("proxy pool select CLI normalizes options, delegates once, and prints pretty JSON", async () => {
  const output = captureStream();
  let request;
  const report = {
    selected_count: 1,
    retained_previous: false,
    proxies: [{ endpoint: "1.1.1.1:80" }],
    output: "custom/selected.json",
  };
  await runProxyPoolSelectCommand({
    argv: [
      "--min-samples", "6",
      "--min-success-rate", "0.9",
      "--max-p95-ms", "2500",
      "--limit", "3",
      "--output", "custom/selected.json",
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
    limit: 3,
    maxP95Ms: 2500,
    minSamples: 6,
    minSuccessRate: 0.9,
    output: "custom/selected.json",
  });
  assert.equal(output.text(), `${JSON.stringify(report, null, 2)}\n`);
});

test("proxy pool select CLI preserves historical defaults", async () => {
  let request;
  await runProxyPoolSelectCommand({
    argv: [],
    stdout: { write() {} },
    useCase: { async execute(value) { request = value; return { selected_count: 0, proxies: [] }; } },
  });
  assert.deepEqual(request, {
    limit: 5,
    maxP95Ms: 3000,
    minSamples: 5,
    minSuccessRate: 0.8,
    output: null,
  });
});

test("proxy pool select protocol errors happen before resolving infrastructure", async () => {
  let resolutions = 0;
  const getUseCase = () => {
    resolutions += 1;
    return { execute() {} };
  };

  await assert.rejects(
    () => runProxyPoolSelectCommand({ argv: ["--min-success-rate", "2"], getUseCase }),
    /--min-success-rate must be between 0 and 1\./
  );
  await assert.rejects(
    () => runProxyPoolSelectCommand({ argv: ["--limit", "0"], getUseCase }),
    /--limit must be a positive integer\./
  );
  await assert.rejects(
    () => runProxyPoolSelectCommand({ argv: ["--max-p95-ms"], getUseCase }),
    /Missing value for --max-p95-ms/
  );
  assert.equal(resolutions, 0);
});

test("proxy pool select factory honors an explicit use case without constructing defaults", async () => {
  const output = captureStream();
  const command = createProxyPoolSelectCommand({
    stdout: output.stream,
    useCase: {
      async execute() {
        return { selected_count: 0, retained_previous: false, proxies: [], output: "selected.json" };
      },
    },
  });
  await command([]);
  assert.match(output.text(), /"selected_count": 0/);
});
