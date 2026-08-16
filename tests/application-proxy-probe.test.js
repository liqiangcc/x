"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ProbeProxyPoolUseCase,
  buildProxyProbeReport,
  buildProxyProbeRound,
} = require("../src/application/proxy/probe_proxy_pool");

test("proxy probe owns round scheduling while reusing one probe session", async () => {
  let current = 1000;
  const calls = [];
  const useCase = new ProbeProxyPoolUseCase({
    sessionFactory: {
      open() {
        calls.push(["open"]);
        return {
          async sample(request) {
            calls.push(["sample", request]);
            return {
              candidate_count: request.samples,
              available_count: request.startIndex === 10 ? 0 : 1,
            };
          },
          async close() {
            calls.push(["close"]);
          },
        };
      },
    },
    reportWriter: {
      async write(report, kind) {
        calls.push(["write", report, kind]);
        assert.equal(Object.hasOwn(report, "report"), false);
        return "runs/proxy-benchmark/example_probe/report.json";
      },
    },
    now: () => current,
    timestamp: () => `t-${current}`,
    sleep: async (milliseconds) => {
      calls.push(["sleep", milliseconds]);
      current += milliseconds;
    },
  });

  const report = await useCase.execute({
    durationMs: 250,
    intervalMs: 100,
    samples: 10,
    concurrency: 3,
    timeoutMs: 4500,
  });

  assert.deepEqual(calls.slice(0, 8), [
    ["open"],
    ["sample", { concurrency: 3, samples: 10, startIndex: 0, timeoutMs: 4500 }],
    ["sleep", 100],
    ["sample", { concurrency: 3, samples: 10, startIndex: 10, timeoutMs: 4500 }],
    ["sleep", 100],
    ["sample", { concurrency: 3, samples: 10, startIndex: 20, timeoutMs: 4500 }],
    ["sleep", 50],
    ["close"],
  ]);
  assert.equal(calls[8][0], "write");
  assert.equal(calls[8][2], "probe");
  assert.equal(report.rounds.length, 3);
  assert.equal(report.rounds[0].started_at, "t-1000");
  assert.equal(report.rounds[0].passed, true);
  assert.equal(report.rounds[1].passed, false);
  assert.equal(report.rounds[2].started_at, "t-1200");
  assert.equal(report.duration_ms, 250);
  assert.equal(report.interval_ms, 100);
  assert.equal(report.target, "eastmoney-kline");
  assert.equal(report.report, "runs/proxy-benchmark/example_probe/report.json");
});

test("proxy probe closes its session when sampling fails", async () => {
  const failure = new Error("sample failed");
  let closed = 0;
  let writes = 0;
  const useCase = new ProbeProxyPoolUseCase({
    sessionFactory: {
      open() {
        return {
          async sample() {
            throw failure;
          },
          async close() {
            closed += 1;
          },
        };
      },
    },
    reportWriter: {
      async write() {
        writes += 1;
      },
    },
  });

  await assert.rejects(() => useCase.execute({ durationMs: 1 }), (error) => error === failure);
  assert.equal(closed, 1);
  assert.equal(writes, 0);
});

test("proxy probe report derivation is deterministic", () => {
  assert.deepEqual(
    buildProxyProbeRound({ available_count: 0, candidate_count: 2 }, "2026-01-01T00:00:00.000Z"),
    {
      available_count: 0,
      candidate_count: 2,
      passed: false,
      started_at: "2026-01-01T00:00:00.000Z",
    }
  );
  assert.deepEqual(
    buildProxyProbeReport({ durationMs: 10, intervalMs: 5, rounds: [] }),
    {
      duration_ms: 10,
      interval_ms: 5,
      rounds: [],
      target: "eastmoney-kline",
    }
  );
});

test("proxy probe requires narrow session factory and report writer capabilities", () => {
  assert.throws(
    () => new ProbeProxyPoolUseCase({ sessionFactory: {}, reportWriter: { write() {} } }),
    /ProxyPoolProbeSessionFactory must expose open\(\)/
  );
  assert.throws(
    () => new ProbeProxyPoolUseCase({ sessionFactory: { open() {} }, reportWriter: {} }),
    /ProxyBenchmarkReportWriter must expose write\(\)/
  );
});
