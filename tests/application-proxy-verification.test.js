"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  VerifyProxyPoolUseCase,
} = require("../src/application/proxy/verify_proxy_pool");

function sampleReport() {
  return {
    available_count: 1,
    available: [{ proxy: "1.1.1.1:80", duration_ms: 100 }],
    candidate_count: 1,
  };
}

test("proxy verification use case orchestrates verifier before report persistence", async () => {
  const calls = [];
  const report = sampleReport();
  const useCase = new VerifyProxyPoolUseCase({
    verifier: {
      async verify(options) {
        calls.push(["verify", options]);
        return report;
      },
    },
    reportWriter: {
      async write(input) {
        calls.push(["write", input]);
        return {
          report: "runs/proxy-verify/run/report.json",
          available: "runs/proxy-verify/run/available.txt",
        };
      },
    },
  });

  const result = await useCase.execute({
    concurrency: 4,
    timeoutMs: 5000,
    limit: 20,
    output: "custom/report.json",
  });

  assert.deepEqual(calls, [
    ["verify", { concurrency: 4, timeoutMs: 5000, limit: 20 }],
    ["write", { output: "custom/report.json", report }],
  ]);
  assert.deepEqual(result, {
    ...report,
    files: {
      report: "runs/proxy-verify/run/report.json",
      available: "runs/proxy-verify/run/available.txt",
    },
  });
  assert.equal("files" in calls[1][1].report, false);
});

test("proxy verification use case omits an unspecified limit", async () => {
  let verifyOptions;
  const useCase = new VerifyProxyPoolUseCase({
    verifier: {
      async verify(options) {
        verifyOptions = options;
        return sampleReport();
      },
    },
    reportWriter: {
      async write() {
        return { report: "report.json", available: "available.txt" };
      },
    },
  });

  await useCase.execute();
  assert.deepEqual(verifyOptions, { concurrency: 8, timeoutMs: 6000 });
});

test("proxy verification use case requires both narrow capabilities", () => {
  assert.throws(
    () => new VerifyProxyPoolUseCase({ reportWriter: { write() {} } }),
    /ProxyPoolVerifier must expose verify\(\)\./
  );
  assert.throws(
    () => new VerifyProxyPoolUseCase({ verifier: { verify() {} } }),
    /ProxyVerificationReportWriter must expose write\(\)\./
  );
});
