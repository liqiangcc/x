"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  fetchAwsRouterKline,
  fetchHuaweiCloudKline,
  parseArguments,
  resolveKline,
} = require("../fetch/fetch_kline");

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(payload),
  };
}

test("fetch_kline parses aws-router engine", () => {
  const options = parseArguments(["600519", "--engine", "aws-router"]);
  assert.equal(options.engine, "aws-router");
});

test("fetch_kline parses Huawei Cloud engine options", () => {
  const options = parseArguments([
    "600519",
    "--engine",
    "huaweicloud",
    "--huaweicloud-region",
    "cn-east-3,cn-north-4",
    "--huaweicloud-region-start-index",
    "1",
    "--huaweicloud-targets",
    "/tmp/targets.json",
  ]);

  assert.equal(options.engine, "huaweicloud");
  assert.equal(options.huaweiCloudRegionValue, "cn-east-3,cn-north-4");
  assert.equal(options.huaweiCloudRegionStartIndex, 1);
  assert.equal(options.huaweiCloudTargetsFile, "/tmp/targets.json");
});

test("fetchAwsRouterKline requires router URL and token", async () => {
  await assert.rejects(
    () => fetchAwsRouterKline(
      "1.600519",
      "101",
      { routerUrlEnv: "AWS_ROUTER_URL", routerTokenEnv: "AWS_ROUTER_TOKEN" },
      {},
      async () => jsonResponse({})
    ),
    /AWS_ROUTER_URL/
  );
  await assert.rejects(
    () => fetchAwsRouterKline(
      "1.600519",
      "101",
      { routerUrlEnv: "AWS_ROUTER_URL", routerTokenEnv: "AWS_ROUTER_TOKEN" },
      { AWS_ROUTER_URL: "https://router.example" },
      async () => jsonResponse({})
    ),
    /AWS_ROUTER_TOKEN/
  );
});

test("fetchAwsRouterKline posts to router and preserves metrics", async () => {
  const requests = [];
  const payload = await fetchAwsRouterKline(
    "1.600519",
    "101",
    { routerUrlEnv: "AWS_ROUTER_URL", routerTokenEnv: "AWS_ROUTER_TOKEN" },
    {
      AWS_ROUTER_URL: "https://router.example/",
      AWS_ROUTER_TOKEN: "secret",
    },
    async (url, options) => {
      requests.push({ url, options });
      return jsonResponse({
        ok: true,
        source_engine: "aws-router",
        source_region: "us-east-1",
        total_duration_ms: 50,
        target_duration_ms: 30,
        eastmoney_duration_ms: 20,
        fallback_count: 1,
        attempted_regions: ["ap-northeast-2", "us-east-1"],
        data: {
          code: "600519",
          market: 1,
          klines: ["2026-06-30,1,2,3,1,100,1000,1,1,1,1"],
        },
      });
    }
  );

  assert.equal(requests[0].url, "https://router.example/kline");
  assert.equal(requests[0].options.headers["x-router-token"], "secret");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    region: "auto",
    secid: "1.600519",
    klt: 101,
    lmt: 100000,
    end: "20991231",
  });
  assert.equal(payload.source_engine, "aws-router");
  assert.equal(payload.source_region, "us-east-1");
  assert.equal(payload.total_duration_ms, 50);
  assert.equal(payload.fallback_count, 1);
  assert.deepEqual(payload.data.klines, ["2026-06-30,1,2,3,1,100,1000,1,1,1,1"]);
});

test("fetchAwsRouterKline reports router failures", async () => {
  await assert.rejects(
    () => fetchAwsRouterKline(
      "1.600519",
      "101",
      { routerUrlEnv: "AWS_ROUTER_URL", routerTokenEnv: "AWS_ROUTER_TOKEN" },
      {
        AWS_ROUTER_URL: "https://router.example",
        AWS_ROUTER_TOKEN: "secret",
      },
      async () => jsonResponse(
        { ok: false, error: "all regions failed" },
        { ok: false, status: 502 }
      )
    ),
    /all regions failed/
  );
});

test("fetchHuaweiCloudKline invokes FunctionGraph and preserves metrics", async () => {
  const requests = [];
  const payload = await fetchHuaweiCloudKline(
    "1.600519",
    "101",
    {
      huaweiCloudAccessKeyEnv: "HUAWEICLOUD_ACCESS_KEY",
      huaweiCloudRegionStartIndex: 0,
      huaweiCloudRegionValue: "cn-east-3",
      huaweiCloudSecretKeyEnv: "HUAWEICLOUD_SECRET_KEY",
      huaweiCloudTargets: {
        "cn-east-3": {
          project_id: "project",
          function_urn: "urn:fss:cn-east-3:project:function:default:x-kline-target",
        },
      },
    },
    {
      HUAWEICLOUD_ACCESS_KEY: "ak",
      HUAWEICLOUD_SECRET_KEY: "sk",
    },
    async (url, request) => {
      requests.push({ url, request });
      return jsonResponse({
        request_id: "request-1",
        result: JSON.stringify({
          ok: true,
          source_region: "cn-east-3",
          target_duration_ms: 30,
          eastmoney_duration_ms: 20,
          data: {
            code: "600519",
            market: 1,
            klines: ["2026-06-30,1,2,3,1,100,1000,1,1,1,1"],
          },
        }),
        status: 200,
      });
    }
  );

  assert.match(requests[0].url, /^https:\/\/functiongraph\.cn-east-3\.myhuaweicloud\.com\/v2\/project\/fgs\/functions\//);
  assert.equal(requests[0].request.method, "POST");
  assert.match(requests[0].request.headers.Authorization, /^SDK-HMAC-SHA256 Access=ak/);
  assert.deepEqual(JSON.parse(requests[0].request.body), {
    end: "20991231",
    klt: 101,
    lmt: 100000,
    secid: "1.600519",
  });
  assert.equal(payload.source_engine, "huaweicloud");
  assert.equal(payload.source_region, "cn-east-3");
  assert.equal(payload.request_id, "request-1");
  assert.equal(payload.target_duration_ms, 30);
  assert.equal(payload.eastmoney_duration_ms, 20);
  assert.equal(payload.data.klines.length, 1);
});

test("resolveKline auto tries Huawei Cloud before AWS and local", async () => {
  const calls = [];
  const payload = await resolveKline(
    {
      awsRegions: ["ap-northeast-1"],
      engine: "auto",
      input: "600519",
      lambdaName: "kline",
      period: "daily",
    },
    {
      fetchAwsKline: async () => {
        calls.push("aws");
        throw new Error("aws unavailable");
      },
      fetchHuaweiCloudKline: async () => {
        calls.push("huaweicloud");
        throw new Error("huaweicloud unavailable");
      },
      fetchLocalKline: async () => {
        calls.push("local");
        return {
          data: {
            code: "600519",
            market: 1,
            klines: ["2026-06-30,1,2,3,1,100,1000,1,1,1,1"],
          },
        };
      },
    }
  );

  assert.deepEqual(calls, ["huaweicloud", "aws", "local"]);
  assert.equal(payload.source_engine, "local");
});
