"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { readQueue, retryDelayMs, updateFailureQueue, writeDueCodes } = require("../src/kline/failure_queue");

test("failure queue applies backoff and moves the third failure to dead letter", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kline-failure-queue-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const queueFile = path.join(dir, "daily.json");
  const deadLetterFile = path.join(dir, "daily.dead.json");
  const results = { "600519": { status: "failed", error: "timeout", error_class: "total_timeout", proxy_id: "abc" } };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await updateFailureQueue({ deadLetterFile, expectedLatestDate: "2026-07-10", period: "daily", queueFile, results });
  }
  assert.equal((await readQueue(queueFile)).items.length, 0);
  const dead = await readQueue(deadLetterFile);
  assert.equal(dead.items[0].attempts, 3);
  assert.equal(dead.items[0].last_proxy_id, "abc");
  assert.equal(retryDelayMs("rate_limited"), 2 * 60 * 60 * 1000);
});

test("due-code output is sync compatible and excludes future retries", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kline-due-queue-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const queueFile = path.join(dir, "daily.json");
  const deadLetterFile = path.join(dir, "daily.dead.json");
  await updateFailureQueue({ deadLetterFile, period: "daily", queueFile, results: {
    "000001": { status: "failed", error_class: "total_timeout" },
  } });
  const output = path.join(dir, "due.json");
  const beforeDue = await writeDueCodes(queueFile, output, new Date());
  assert.deepEqual(beforeDue.codes, []);
  const afterDue = await writeDueCodes(queueFile, output, new Date(Date.now() + 31 * 60 * 1000));
  assert.deepEqual(afterDue.codes, ["000001"]);
  assert.deepEqual(JSON.parse(await fs.readFile(output, "utf8")).codes, ["000001"]);
});
