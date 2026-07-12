"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { acquireSyncLock, readLock } = require("../src/kline/sync_lock");

test("sync lock rejects a concurrent owner and releases cleanly", async () => {
  const period = `test-${process.pid}`;
  const lock = await acquireSyncLock(period);
  assert.equal((await readLock(period)).alive, true);
  await assert.rejects(() => acquireSyncLock(period), /already running/);
  await lock.release();
  assert.equal((await readLock(period)).status, "unlocked");
});
