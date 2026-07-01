"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  normalizeLatencyOptions,
  runLatencyBenchmark,
  summarizeResults,
} = require("../src/aws/latency");

function lambdaClientFactory() {
  return {
    send: async () => ({
      Payload: Buffer.from(JSON.stringify({
        statusCode: 200,
        body: {
          data: [{ f51: "2026-06-30" }, { f51: "2026-07-01" }],
        },
      })),
    }),
  };
}

function routerProbeFetch(regions) {
  return async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      ok: true,
      source_engine: "aws-router-probe",
      results: regions.map((region, index) => ({
        ok: true,
        region,
        total_duration_ms: 10 + index,
        target_duration_ms: 8 + index,
        eastmoney_duration_ms: 7 + index,
      })),
    }),
  });
}

const HUAWEICLOUD_TARGETS = {
  "cn-east-3": {
    project_id: "project",
    function_urn: "urn:fss:cn-east-3:project:function:default:x-kline-target",
  },
};

function huaweiCloudFetch(assertUrl) {
  return async (url, request) => {
    assertUrl?.(url, request);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        request_id: "hwc-request-1",
        result: JSON.stringify({
          ok: true,
          target_duration_ms: 13,
          eastmoney_duration_ms: 9,
          data: { klines: ["row"] },
        }),
        status: 200,
      }),
    };
  };
}

test("normalizeLatencyOptions applies region alias to both engines", () => {
  const options = normalizeLatencyOptions(
    {
      attempts: "2",
      engine: "both",
      region: "ap-northeast-1,us-east-1",
      secid: "600519",
    },
    {
      aws_regions: ["ap-southeast-1"],
      lambda_name: "kline-prod",
    }
  );

  assert.equal(options.secid, "1.600519");
  assert.equal(options.lambdaName, "kline-prod");
  assert.deepEqual(options.awsRegions, ["ap-northeast-1", "us-east-1"]);
  assert.deepEqual(options.routerRegions, ["ap-northeast-1", "us-east-1"]);
  assert.equal(options.attempts, 2);
});

test("normalizeLatencyOptions keeps both as AWS only and expands all to Huawei Cloud", () => {
  const bothOptions = normalizeLatencyOptions(
    {
      engine: "both",
      region: "ap-northeast-1",
    },
    { aws_regions: ["ap-northeast-1"] }
  );
  assert.deepEqual(bothOptions.awsRegions, ["ap-northeast-1"]);
  assert.deepEqual(bothOptions.routerRegions, ["ap-northeast-1"]);
  assert.deepEqual(bothOptions.huaweiCloudRegions, []);

  const huaweiCloudOptions = normalizeLatencyOptions({
    engine: "huaweicloud",
    huaweicloudRegion: "cn-east-3",
    huaweicloudTargetsData: HUAWEICLOUD_TARGETS,
  });
  assert.deepEqual(huaweiCloudOptions.awsRegions, []);
  assert.deepEqual(huaweiCloudOptions.routerRegions, []);
  assert.deepEqual(huaweiCloudOptions.huaweiCloudRegions, ["cn-east-3"]);

  const allOptions = normalizeLatencyOptions(
    {
      engine: "all",
      region: "all",
      huaweicloudTargetsData: HUAWEICLOUD_TARGETS,
    },
    { aws_regions: ["ap-northeast-1"] }
  );
  assert.deepEqual(allOptions.awsRegions, ["ap-northeast-1"]);
  assert.equal(allOptions.routerRegions, "all");
  assert.deepEqual(allOptions.huaweiCloudRegions, ["cn-east-3"]);
});

test("normalizeLatencyOptions expands aws all from config and keeps router all", () => {
  const awsOptions = normalizeLatencyOptions(
    { engine: "aws", region: "all" },
    { aws_regions: ["ap-northeast-1", "ap-northeast-2"] }
  );
  assert.deepEqual(awsOptions.awsRegions, ["ap-northeast-1", "ap-northeast-2"]);

  const routerOptions = normalizeLatencyOptions({ engine: "aws-router", region: "all" }, {});
  assert.equal(routerOptions.routerRegions, "all");

  assert.throws(
    () => normalizeLatencyOptions({ engine: "aws-router", region: "all", routerMode: "kline" }, {}),
    /requires explicit/
  );
});

test("runLatencyBenchmark records aws and aws-router region summaries", async () => {
  const options = normalizeLatencyOptions(
    {
      attempts: "2",
      engine: "both",
      region: "ap-northeast-1",
      secid: "1.600519",
    },
    { aws_regions: ["ap-northeast-1"] }
  );
  const report = await runLatencyBenchmark(options, {
    env: {
      AWS_ROUTER_URL: "https://router.example",
      AWS_ROUTER_TOKEN: "secret",
    },
    fetchImpl: routerProbeFetch(["ap-northeast-1"]),
    lambdaClientFactory,
  });

  assert.equal(report.results.length, 4);
  assert.equal(report.summary.aws.regions["ap-northeast-1"].successes, 2);
  assert.equal(report.summary["aws-router"].regions["ap-northeast-1"].successes, 2);
  assert.equal(report.results.find((item) => item.engine === "aws").points, 2);
  assert.equal(report.results.find((item) => item.engine === "aws-router").target_duration_ms, 8);
});

test("runLatencyBenchmark records Huawei Cloud FunctionGraph region summaries", async () => {
  const options = normalizeLatencyOptions({
    attempts: "2",
    engine: "huaweicloud",
    huaweicloudRegion: "cn-east-3",
    huaweicloudTargetsData: HUAWEICLOUD_TARGETS,
    secid: "1.600519",
  });
  const report = await runLatencyBenchmark(options, {
    env: {
      HUAWEICLOUD_ACCESS_KEY: "ak",
      HUAWEICLOUD_SECRET_KEY: "sk",
    },
    fetchImpl: huaweiCloudFetch((url, request) => {
      assert.match(url, /^https:\/\/functiongraph\.cn-east-3\.myhuaweicloud\.com\/v2\/project\/fgs\/functions\/urn%3Afss%3A/);
      assert.equal(request.method, "POST");
      assert.match(request.headers.Authorization, /^SDK-HMAC-SHA256 Access=ak/);
    }),
  });

  assert.equal(report.results.length, 2);
  assert.equal(report.summary.huaweicloud.regions["cn-east-3"].successes, 2);
  assert.equal(report.results[0].points, 1);
  assert.equal(report.results[0].target_duration_ms, 13);
  assert.equal(report.results[0].eastmoney_duration_ms, 9);
  assert.equal(report.results[0].request_id, "hwc-request-1");
});

test("runLatencyBenchmark reports missing Huawei Cloud target regions", async () => {
  const options = normalizeLatencyOptions({
    attempts: "1",
    engine: "huaweicloud",
    huaweicloudRegion: "cn-north-4",
    huaweicloudTargetsData: HUAWEICLOUD_TARGETS,
    secid: "1.600519",
  });
  const report = await runLatencyBenchmark(options, {
    env: {
      HUAWEICLOUD_ACCESS_KEY: "ak",
      HUAWEICLOUD_SECRET_KEY: "sk",
    },
    fetchImpl: huaweiCloudFetch(),
  });

  assert.equal(report.results.length, 1);
  assert.equal(report.results[0].ok, false);
  assert.equal(report.results[0].error_class, "missing_huaweicloud_target");
  assert.equal(report.summary.huaweicloud.regions["cn-north-4"].failures, 1);
});

test("runLatencyBenchmark expands router probe all into per-region rows", async () => {
  const options = normalizeLatencyOptions(
    {
      attempts: "1",
      engine: "aws-router",
      region: "all",
      secid: "1.600519",
    },
    {}
  );
  const report = await runLatencyBenchmark(options, {
    env: {
      AWS_ROUTER_URL: "https://router.example",
      AWS_ROUTER_TOKEN: "secret",
    },
    fetchImpl: routerProbeFetch(["ap-northeast-1", "us-east-1"]),
  });

  assert.deepEqual(
    report.results.map((item) => item.region),
    ["ap-northeast-1", "us-east-1"]
  );
  assert.equal(report.summary["aws-router"].regions["us-east-1"].attempts, 1);
});

test("summarizeResults computes latency percentiles", () => {
  const summary = summarizeResults([
    { engine: "aws", region: "r1", ok: true, client_duration_ms: 30 },
    { engine: "aws", region: "r1", ok: true, client_duration_ms: 10 },
    { engine: "aws", region: "r1", ok: false, client_duration_ms: 20 },
  ]);

  assert.equal(summary.aws.regions.r1.attempts, 3);
  assert.equal(summary.aws.regions.r1.successes, 2);
  assert.equal(summary.aws.regions.r1.avg_ms, 20);
  assert.equal(summary.aws.regions.r1.p50_ms, 20);
  assert.equal(summary.aws.regions.r1.p95_ms, 30);
});
