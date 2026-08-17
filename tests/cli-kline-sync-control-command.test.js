"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createKlineSyncControlCommand,
  formatJson,
  runKlineSyncControlCommand,
} = require("../src/adapters/cli/commands/kline_sync_control");

function writer() {
  let text = "";
  return {
    stream: { write(chunk) { text += chunk; } },
    text: () => text,
  };
}

test("sync-status reads daily and yearly by default and prints pretty JSON", async () => {
  const calls = [];
  const out = writer();
  const payload = await runKlineSyncControlCommand({
    action: "sync-status",
    readLock: async (period) => {
      calls.push(period);
      return { period, status: "unlocked" };
    },
    stdout: out.stream,
  });

  assert.deepEqual(calls, ["daily", "yearly"]);
  assert.deepEqual(payload, {
    locks: [
      { period: "daily", status: "unlocked" },
      { period: "yearly", status: "unlocked" },
    ],
  });
  assert.equal(out.text(), formatJson(payload));
});

test("sync-status preserves arbitrary explicit period values", async () => {
  const calls = [];
  await runKlineSyncControlCommand({
    action: "sync-status",
    argv: ["--period", "custom"],
    readLock: async (period) => {
      calls.push(period);
      return { period };
    },
    stdout: { write() {} },
  });
  assert.deepEqual(calls, ["custom"]);
});

test("unlock validates period before resolving capability", async () => {
  let resolved = false;
  await assert.rejects(
    () => runKlineSyncControlCommand({
      action: "unlock",
      argv: ["--period", "weekly"],
      resolveCapability: () => {
        resolved = true;
        return {};
      },
    }),
    /kline unlock requires --period daily\|yearly\./,
  );
  assert.equal(resolved, false);
});

test("unlock delegates period and force then prints result", async () => {
  const calls = [];
  const out = writer();
  const payload = await runKlineSyncControlCommand({
    action: "unlock",
    argv: ["--period", "daily", "--force"],
    unlockSync: async (...args) => {
      calls.push(args);
      return { period: "daily", removed: true };
    },
    stdout: out.stream,
  });
  assert.deepEqual(calls, [["daily", { force: true }]]);
  assert.deepEqual(payload, { period: "daily", removed: true });
  assert.equal(out.text(), formatJson(payload));
});

test("option parser errors occur before lazy capability resolution", async () => {
  let resolved = false;
  const command = createKlineSyncControlCommand({
    createCapability: () => {
      resolved = true;
      return { readLock: async () => ({}) };
    },
  });
  await assert.rejects(
    () => command("sync-status", ["--period"]),
    /Missing value for --period/,
  );
  assert.equal(resolved, false);
});

test("capability requirements are narrow per action", async () => {
  const statusOut = writer();
  const unlockOut = writer();
  await runKlineSyncControlCommand({
    action: "sync-status",
    readLock: async (period) => ({ period }),
    stdout: statusOut.stream,
  });
  await runKlineSyncControlCommand({
    action: "unlock",
    argv: ["--period", "yearly"],
    unlockSync: async (period, options) => ({ period, force: options.force }),
    stdout: unlockOut.stream,
  });
  assert.match(statusOut.text(), /daily/);
  assert.match(unlockOut.text(), /yearly/);
});
