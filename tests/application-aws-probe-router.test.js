"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ProbeAwsRouterUseCase,
  buildRouterProbeRequest,
  periodToKlt,
} = require("../src/application/aws/probe_router");

test("aws router probe request preserves existing defaults and secid inference", () => {
  assert.deepEqual(buildRouterProbeRequest({ secid: "600519" }), {
    region: "all",
    secid: "1.600519",
    klt: 101,
    lmt: 1,
    end: "20991231",
  });
  assert.deepEqual(
    buildRouterProbeRequest({
      end: "20261231",
      lmt: "5",
      period: "yearly",
      secid: "0.000001",
      targetRegion: "ap-northeast-1",
    }),
    {
      region: "ap-northeast-1",
      secid: "0.000001",
      klt: 106,
      lmt: 5,
      end: "20261231",
    }
  );
});

test("aws router probe request preserves validation errors", () => {
  assert.throws(
    () => buildRouterProbeRequest(),
    /aws probe-router requires --secid <secid_or_code>\./
  );
  assert.equal(periodToKlt("daily"), 101);
  assert.equal(periodToKlt("yearly"), 106);
  assert.throws(() => periodToKlt("weekly"), /Invalid period: weekly/);
});

test("aws router probe use case delegates only the normalized request", async () => {
  const calls = [];
  const useCase = new ProbeAwsRouterUseCase({
    routerProbeClient: {
      async probe(request) {
        calls.push(request);
        return { ok: true, region: request.region };
      },
    },
  });

  assert.deepEqual(
    await useCase.execute({ secid: "600519", targetRegion: "all" }),
    { ok: true, region: "all" }
  );
  assert.deepEqual(calls, [
    {
      region: "all",
      secid: "1.600519",
      klt: 101,
      lmt: 1,
      end: "20991231",
    },
  ]);
});
