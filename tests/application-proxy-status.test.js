"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CheckProxyPoolStatusUseCase,
} = require("../src/application/proxy/check_proxy_pool_status");

test("proxy status inspects runtime before counting candidates", async () => {
  const events = [];
  const useCase = new CheckProxyPoolStatusUseCase({
    runtimeInspector: {
      async inspect() {
        events.push("runtime");
        return { stdout: "compose\n", stderr: "warn\n" };
      },
    },
    candidateCounter: {
      async count() {
        events.push("candidates");
        return 17;
      },
    },
  });

  const result = await useCase.execute();
  assert.deepEqual(events, ["runtime", "candidates"]);
  assert.deepEqual(result, {
    runtime: { stdout: "compose\n", stderr: "warn\n" },
    report: { ok: true, cn_candidates: 17 },
    exitCode: 0,
  });
});

test("proxy status converts candidate failure into diagnostic report", async () => {
  const useCase = new CheckProxyPoolStatusUseCase({
    runtimeInspector: { inspect: async () => ({ stdout: "compose\n", stderr: "" }) },
    candidateCounter: {
      async count() {
        throw new Error("candidate service unavailable");
      },
    },
  });

  assert.deepEqual(await useCase.execute(), {
    runtime: { stdout: "compose\n", stderr: "" },
    report: {
      ok: false,
      error: "candidate service unavailable",
      cn_candidates: 0,
    },
    exitCode: 1,
  });
});

test("proxy status propagates runtime failure without counting candidates", async () => {
  let candidateCalls = 0;
  const useCase = new CheckProxyPoolStatusUseCase({
    runtimeInspector: {
      async inspect() {
        throw new Error("docker failed");
      },
    },
    candidateCounter: {
      async count() {
        candidateCalls += 1;
        return 1;
      },
    },
  });

  await assert.rejects(() => useCase.execute(), /docker failed/);
  assert.equal(candidateCalls, 0);
});

test("proxy status requires narrow runtime and candidate ports", () => {
  assert.throws(
    () => new CheckProxyPoolStatusUseCase({ runtimeInspector: {}, candidateCounter: { count() {} } }),
    /ProxyPoolRuntimeInspector must expose inspect\(\)/
  );
  assert.throws(
    () => new CheckProxyPoolStatusUseCase({ runtimeInspector: { inspect() {} }, candidateCounter: {} }),
    /ProxyPoolCandidateCounter must expose count\(\)/
  );
});
