"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  RunProxyPoolBenchmarkUseCase,
} = require("../src/application/proxy/run_proxy_pool_benchmark");

test("proxy benchmark runs existing capability then persists the untouched report", async () => {
  const calls = [];
  const useCase = new RunProxyPoolBenchmarkUseCase({
    benchmarkRunner: {
      async run(request) {
        calls.push(["run", request]);
        return {
          samples: request.samples,
          concurrency: request.concurrency,
          success: 95,
          failed: 5,
          passed: true,
          target: "eastmoney-kline",
        };
      },
    },
    reportWriter: {
      async write(report, kind) {
        calls.push(["write", report, kind]);
        assert.equal(Object.hasOwn(report, "report"), false);
        return "runs/proxy-benchmark/example_benchmark/report.json";
      },
    },
  });

  const report = await useCase.execute({ samples: 100, concurrency: 4 });

  assert.deepEqual(calls[0], ["run", { samples: 100, concurrency: 4 }]);
  assert.equal(calls[1][0], "write");
  assert.equal(calls[1][2], "benchmark");
  assert.deepEqual(calls[1][1], {
    samples: 100,
    concurrency: 4,
    success: 95,
    failed: 5,
    passed: true,
    target: "eastmoney-kline",
  });
  assert.equal(report.report, "runs/proxy-benchmark/example_benchmark/report.json");
  assert.equal(report.passed, true);
});

test("proxy benchmark preserves failed reports instead of changing pass semantics", async () => {
  let persisted = null;
  const useCase = new RunProxyPoolBenchmarkUseCase({
    benchmarkRunner: {
      async run() {
        return { samples: 100, success: 10, failed: 90, passed: false };
      },
    },
    reportWriter: {
      async write(report) {
        persisted = report;
        return "runs/proxy-benchmark/example_benchmark/report.json";
      },
    },
  });

  const report = await useCase.execute();
  assert.equal(report.passed, false);
  assert.equal(persisted.passed, false);
});

test("proxy benchmark requires narrow runner and report writer capabilities", () => {
  assert.throws(
    () => new RunProxyPoolBenchmarkUseCase({ benchmarkRunner: {}, reportWriter: { write() {} } }),
    /ProxyPoolBenchmarkRunner must expose run\(\)/
  );
  assert.throws(
    () => new RunProxyPoolBenchmarkUseCase({ benchmarkRunner: { run() {} }, reportWriter: {} }),
    /ProxyBenchmarkReportWriter must expose write\(\)/
  );
});
