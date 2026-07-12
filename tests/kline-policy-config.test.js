"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("proxy-first uses selected proxies and excludes Huawei Cloud", () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "../config/kline.json"), "utf8"));
  const engines = config.policies["proxy-first"].engines;
  assert.equal(engines[0].name, "proxy-pool");
  assert.equal(engines[0].selectedOnly, true);
  assert.equal(engines[0].maxAttempts, 1);
  assert.deepEqual(engines.slice(1), ["aws-router", "aws", "local"]);
  assert.ok(!engines.some((entry) => (entry.name ?? entry) === "huaweicloud"));
});
