"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  invokeFunctionGraph,
  loadHuaweiCloudTargets,
  normalizeHuaweiCloudTarget,
  signRequest,
} = require("../src/huaweicloud/functiongraph");

test("signRequest builds canonical Huawei Cloud authorization", () => {
  const signed = signRequest({
    accessKey: "test-ak",
    secretKey: "test-sk",
    method: "POST",
    url: "https://functiongraph.cn-east-3.myhuaweicloud.com/v2/project/fgs/functions/urn%3Afss%3Afn/invocations?b=2&a=1",
    headers: {
      "Content-Type": "application/json",
    },
    body: "{\"ok\":true}",
    date: new Date("2026-07-01T00:00:00Z"),
  });

  assert.equal(
    signed.canonicalRequest,
    [
      "POST",
      "/v2/project/fgs/functions/urn%3Afss%3Afn/invocations/",
      "a=1&b=2",
      "content-type:application/json\nhost:functiongraph.cn-east-3.myhuaweicloud.com\nx-sdk-date:20260701T000000Z\n",
      "content-type;host;x-sdk-date",
      "4062edaf750fb8074e7e83e0c9028c94e32468a8b6f1614774328ef045150f93",
    ].join("\n")
  );
  assert.equal(signed.signedHeaders, "content-type;host;x-sdk-date");
  assert.match(
    signed.headers.Authorization,
    /^SDK-HMAC-SHA256 Access=test-ak, SignedHeaders=content-type;host;x-sdk-date, Signature=[0-9a-f]{64}$/
  );
  assert.equal(signed.headers["X-Sdk-Date"], "20260701T000000Z");
});

test("loadHuaweiCloudTargets reads file before env", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "x-hwc-targets-"));
  const targetsFile = path.join(tempDir, "targets.json");
  fs.writeFileSync(targetsFile, JSON.stringify({
    "cn-east-3": {
      project_id: "from-file",
      function_urn: "urn:file",
    },
  }));

  const targets = loadHuaweiCloudTargets({
    env: {
      HUAWEICLOUD_TARGETS_JSON: JSON.stringify({
        "cn-south-1": {
          project_id: "from-env",
          function_urn: "urn:env",
        },
      }),
    },
    targetsFile,
  });

  assert.deepEqual(Object.keys(targets), ["cn-east-3"]);
  assert.equal(targets["cn-east-3"].project_id, "from-file");
});

test("normalizeHuaweiCloudTarget validates required fields", () => {
  assert.deepEqual(normalizeHuaweiCloudTarget("cn-east-3", {
    project_id: "project",
    function_urn: "urn:fss:fn",
  }), {
    functionUrn: "urn:fss:fn",
    ok: true,
    projectId: "project",
    region: "cn-east-3",
  });
  assert.equal(normalizeHuaweiCloudTarget("cn-east-3", {}).ok, false);
});

test("invokeFunctionGraph parses successful result payload", async () => {
  let calledUrl = null;
  const response = await invokeFunctionGraph({
    accessKey: "ak",
    secretKey: "sk",
    date: new Date("2026-07-01T00:00:00Z"),
    fetchImpl: async (url, request) => {
      calledUrl = url;
      assert.equal(request.method, "POST");
      assert.equal(request.headers["X-Sdk-Date"], "20260701T000000Z");
      assert.match(request.headers.Authorization, /^SDK-HMAC-SHA256 Access=ak/);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          request_id: "request-1",
          result: JSON.stringify({
            ok: true,
            target_duration_ms: 12,
            data: { klines: ["row"] },
          }),
          status: 200,
        }),
      };
    },
    payload: {
      end: "20991231",
      klt: 101,
      lmt: 1,
      secid: "1.600519",
    },
    target: {
      functionUrn: "urn:fss:cn-east-3:project:function:default:x-kline-target",
      projectId: "project",
      region: "cn-east-3",
    },
  });

  assert.equal(calledUrl, "https://functiongraph.cn-east-3.myhuaweicloud.com/v2/project/fgs/functions/urn%3Afss%3Acn-east-3%3Aproject%3Afunction%3Adefault%3Ax-kline-target/invocations");
  assert.equal(response.requestId, "request-1");
  assert.equal(response.resultPayload.target_duration_ms, 12);
});

test("invokeFunctionGraph reports HTTP and result parse failures", async () => {
  await assert.rejects(
    () => invokeFunctionGraph({
      accessKey: "ak",
      fetchImpl: async () => ({
        ok: false,
        status: 403,
        text: async () => JSON.stringify({ error_msg: "forbidden" }),
      }),
      payload: {},
      secretKey: "sk",
      target: {
        functionUrn: "urn:fss:fn",
        projectId: "project",
        region: "cn-east-3",
      },
    }),
    /FunctionGraph returned statusCode 403: forbidden/
  );

  await assert.rejects(
    () => invokeFunctionGraph({
      accessKey: "ak",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ result: "not-json", status: 200 }),
      }),
      payload: {},
      secretKey: "sk",
      target: {
        functionUrn: "urn:fss:fn",
        projectId: "project",
        region: "cn-east-3",
      },
    }),
    /Failed to parse FunctionGraph result/
  );
});
