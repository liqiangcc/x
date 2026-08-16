"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  WarmupProxyPoolUseCase,
  buildProxyWarmupReport,
  buildProxyWarmupRound,
} = require("../src/application/proxy/warmup_proxy_pool");

test("proxy warmup owns timed benchmark orchestration and persists projected rounds", async () => {
  let current = 1000;
  let roundIndex = 0;
  const calls = [];
  const useCase = new WarmupProxyPoolUseCase({
    benchmarkRunner: {
      async run(request) {
        const index = roundIndex;
        roundIndex += 1;
        calls.push(["run", request, index]);
        return {
          started_at: `round-start-${index}`,
          samples: request.samples,
          success: index === 1 ? 20 : 10,
          failed: index === 1 ? 0 : 10,
          success_rate: index === 1 ? 1 : 0.5,
          eligible_proxy_count: index + 2,
          stable_proxy_count: index + 1,
          p50_duration_ms: 100 + index,
          p95_duration_ms: 200 + index,
          passed: index === 1,
          selector: "balanced",
          target: "eastmoney-kline",
          results: [{ ignored: true }],
        };
      },
    },
    reportWriter: {
      async write(report, kind) {
        calls.push(["write", report, kind]);
        assert.equal(Object.hasOwn(report, "report"), false);
        return "runs/proxy-benchmark/example_warmup/report.json";
      },
    },
    now: () => current,
    timestamp: () => `ts-${current}`,
    sleep: async (milliseconds) => {
      calls.push(["sleep", milliseconds]);
      current += milliseconds;
    },
  });

  const report = await useCase.execute({
    durationMs: 125_000,
    samples: 20,
    concurrency: 4,
  });

  assert.deepEqual(calls.slice(0, 6), [
    ["run", { samples: 20, concurrency: 4 }, 0],
    ["sleep", 60_000],
    ["run", { samples: 20, concurrency: 4 }, 1],
    ["sleep", 60_000],
    ["run", { samples: 20, concurrency: 4 }, 2],
    ["sleep", 5_000],
  ]);
  assert.equal(calls[6][0], "write");
  assert.equal(calls[6][2], "warmup");
  assert.equal(report.started_at, "round-start-0");
  assert.equal(report.finished_at, "ts-126000");
  assert.equal(report.duration_ms, 125_000);
  assert.equal(report.rounds.length, 3);
  assert.deepEqual(report.rounds[0], {
    samples: 20,
    success: 10,
    failed: 10,
    success_rate: 0.5,
    eligible_proxy_count: 2,
    stable_proxy_count: 1,
    p95_duration_ms: 200,
    passed: false,
    selector: "balanced",
    target: "eastmoney-kline",
  });
  assert.equal(Object.hasOwn(report.rounds[0], "results"), false);
  assert.equal(Object.hasOwn(report.rounds[0], "p50_duration_ms"), false);
  assert.equal(report.passed, true);
  assert.equal(report.report, "runs/proxy-benchmark/example_warmup/report.json");
});

test("proxy warmup preserves all-failed semantics", async () => {
  let current = 0;
  let persisted = null;
  const useCase = new WarmupProxyPoolUseCase({
    benchmarkRunner: {
      async run() {
        return {
          started_at: "round-start",
          samples: 20,
          success: 0,
          failed: 20,
          success_rate: 0,
          passed: false,
        };
      },
    },
    reportWriter: {
      async write(report) {
        persisted = report;
        return "runs/proxy-benchmark/example_warmup/report.json";
      },
    },
    now: () => current,
    timestamp: () => "finished",
    sleep: async (milliseconds) => {
      current += milliseconds;
    },
  });

  const report = await useCase.execute({ durationMs: 1 });
  assert.equal(report.passed, false);
  assert.equal(persisted.passed, false);
  assert.equal(persisted.rounds.length, 1);
});

test("proxy warmup does not persist a report when the benchmark capability fails", async () => {
  const failure = new Error("benchmark failed");
  let writes = 0;
  const useCase = new WarmupProxyPoolUseCase({
    benchmarkRunner: {
      async run() {
        throw failure;
      },
    },
    reportWriter: {
      async write() {
        writes += 1;
      },
    },
  });

  await assert.rejects(() => useCase.execute({ durationMs: 1 }), (error) => error === failure);
  assert.equal(writes, 0);
});

test("proxy warmup report derivation is deterministic", () => {
  assert.deepEqual(
    buildProxyWarmupRound({
      samples: 20,
      success: 18,
      failed: 2,
      success_rate: 0.9,
      eligible_proxy_count: 5,
      stable_proxy_count: 3,
      p95_duration_ms: 900,
      passed: true,
      selector: "balanced",
      target: "eastmoney-kline",
      ignored: true,
    }),
    {
      samples: 20,
      success: 18,
      failed: 2,
      success_rate: 0.9,
      eligible_proxy_count: 5,
      stable_proxy_count: 3,
      p95_duration_ms: 900,
      passed: true,
      selector: "balanced",
      target: "eastmoney-kline",
    }
  );
  assert.deepEqual(
    buildProxyWarmupReport({
      durationMs: 1000,
      rounds: [{ passed: false }, { passed: true }],
      startedAt: "start",
      finishedAt: "finish",
    }),
    {
      started_at: "start",
      finished_at: "finish",
      duration_ms: 1000,
      rounds: [
        {
          samples: undefined,
          success: undefined,
          failed: undefined,
          success_rate: undefined,
          eligible_proxy_count: undefined,
          stable_proxy_count: undefined,
          p95_duration_ms: undefined,
          passed: false,
          selector: undefined,
          target: undefined,
        },
        {
          samples: undefined,
          success: undefined,
          failed: undefined,
          success_rate: undefined,
          eligible_proxy_count: undefined,
          stable_proxy_count: undefined,
          p95_duration_ms: undefined,
          passed: true,
          selector: undefined,
          target: undefined,
        },
      ],
      passed: true,
    }
  );
});

test("proxy warmup requires existing benchmark runner and report writer capabilities", () => {
  assert.throws(
    () => new WarmupProxyPoolUseCase({ benchmarkRunner: {}, reportWriter: { write() {} } }),
    /ProxyPoolBenchmarkRunner must expose run\(\)/
  );
  assert.throws(
    () => new WarmupProxyPoolUseCase({ benchmarkRunner: { run() {} }, reportWriter: {} }),
    /ProxyBenchmarkReportWriter must expose write\(\)/
  );
});
