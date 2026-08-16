"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DiagnoseProxyPoolUseCase,
  buildProxyDiagnosticReport,
} = require("../src/application/proxy/diagnose_proxy_pool");

test("proxy diagnose runs diagnostics, decorates semantics, then persists report", async () => {
  const calls = [];
  const useCase = new DiagnoseProxyPoolUseCase({
    diagnosticRunner: {
      async run(request) {
        calls.push(["run", request]);
        return { candidate_count: 3, available_count: 2, success_rate: 2 / 3 };
      },
    },
    reportWriter: {
      async write(report, kind) {
        calls.push(["write", report, kind]);
        assert.equal(Object.hasOwn(report, "report"), false);
        return "runs/proxy-benchmark/example_diagnose/report.json";
      },
    },
  });

  const report = await useCase.execute({ concurrency: 4, samples: 20, timeoutMs: 2500 });

  assert.deepEqual(calls[0], ["run", { concurrency: 4, samples: 20, timeoutMs: 2500 }]);
  assert.equal(calls[1][0], "write");
  assert.equal(calls[1][2], "diagnose");
  assert.equal(calls[1][1].target, "eastmoney-kline");
  assert.equal(calls[1][1].passed, true);
  assert.equal(report.report, "runs/proxy-benchmark/example_diagnose/report.json");
  assert.equal(report.passed, true);
});

test("proxy diagnose preserves zero-availability as a normal passed=false report", async () => {
  let persisted = null;
  const useCase = new DiagnoseProxyPoolUseCase({
    diagnosticRunner: {
      async run() {
        return { candidate_count: 5, available_count: 0, success_rate: 0 };
      },
    },
    reportWriter: {
      async write(report) {
        persisted = report;
        return "runs/proxy-benchmark/example_diagnose/report.json";
      },
    },
  });

  const report = await useCase.execute();
  assert.equal(report.passed, false);
  assert.equal(persisted.passed, false);
  assert.equal(persisted.target, "eastmoney-kline");
});

test("proxy diagnostic report derivation is deterministic", () => {
  assert.deepEqual(
    buildProxyDiagnosticReport({ available_count: 1, candidate_count: 2 }),
    {
      available_count: 1,
      candidate_count: 2,
      target: "eastmoney-kline",
      passed: true,
    }
  );
});

test("proxy diagnose requires narrow runner and report writer capabilities", () => {
  assert.throws(
    () => new DiagnoseProxyPoolUseCase({ diagnosticRunner: {}, reportWriter: { write() {} } }),
    /ProxyPoolDiagnosticRunner must expose run\(\)/
  );
  assert.throws(
    () => new DiagnoseProxyPoolUseCase({ diagnosticRunner: { run() {} }, reportWriter: {} }),
    /ProxyBenchmarkReportWriter must expose write\(\)/
  );
});
