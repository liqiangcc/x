"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const BIN = path.join(ROOT, "bin", "x");

function runCli(args) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

test("real CLI preserves retry-queue protocol errors before queue access", () => {
  for (const { args, error } of [
    {
      args: ["kline", "retry-queue"],
      error: "kline retry-queue requires <queue.json>.\n",
    },
    {
      args: ["kline", "retry-queue", "queue.json", "--policy"],
      error: "Missing value for --policy\n",
    },
    {
      args: ["kline", "retry-queue", "queue.json", "--concurrency"],
      error: "Missing value for --concurrency\n",
    },
  ]) {
    const result = runCli(args);
    assert.equal(result.status, 1, args.join(" "));
    assert.equal(result.stdout, "", args.join(" "));
    assert.equal(result.stderr, error, args.join(" "));
  }
});

test("real CLI reports no due items through default retry-queue composition", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "x-retry-queue-cli-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const queueFile = path.join(dir, "daily.json");
  await fs.writeFile(queueFile, `${JSON.stringify({
    version: 1,
    period: "daily",
    expected_latest_date: "2026-08-17",
    items: [],
  })}\n`, "utf8");

  const result = runCli(["kline", "retry-queue", queueFile]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), {
    status: "no_due_items",
    queue: queueFile,
    due: 0,
  });
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(dir, "daily.due.json"), "utf8")),
    {
      period: "daily",
      expected_latest_date: "2026-08-17",
      total_codes: 0,
      codes: [],
    },
  );
});

test("bin/x delegates retry-queue without command-to-command kline sync", async () => {
  const source = await fs.readFile(BIN, "utf8");
  assert.match(source, /createKlineRetryQueueCommand/);
  assert.match(
    source,
    /const commandKlineRetryQueue = createKlineRetryQueueCommand\(\{ root: ROOT \}\);/,
  );
  assert.match(source, /await commandKlineRetryQueue\(rest\);/);
  assert.doesNotMatch(source, /async function commandKlineRetryQueue\(/);
  assert.doesNotMatch(source, /writeDueCodes/);
  assert.doesNotMatch(source, /await commandKlineSync\(args\);/);
  assert.match(source, /const commandKlineSync = createKlineSyncCommand\(\{ root: ROOT \}\);/);
  assert.match(source, /await commandKlineSync\(rest\);/);
  assert.match(source, /async function commandDaily\(/);
});
