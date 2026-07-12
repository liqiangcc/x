"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { boundedDestroy, withHardDeadline } = require("../src/proxy/transport/http_proxy");

test("hard deadline rejects callbacks that never settle", async () => {
  const started = Date.now();
  await assert.rejects(() => withHardDeadline(() => new Promise(() => {}), 20), /hard deadline exceeded/);
  assert.ok(Date.now() - started < 200);
});

test("bounded destroy does not wait indefinitely", async () => {
  const started = Date.now();
  await boundedDestroy({ destroy: () => new Promise(() => {}) }, 20);
  assert.ok(Date.now() - started < 200);
});
