"use strict";

const { parseCliOptions } = require("../option_parser");

function formatJson(payload) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function requireReadLock(value) {
  if (typeof value !== "function") {
    throw new TypeError("kline sync control readLock must be a function.");
  }
  return value;
}

function requireUnlockSync(value) {
  if (typeof value !== "function") {
    throw new TypeError("kline sync control unlockSync must be a function.");
  }
  return value;
}

async function runKlineSyncControlCommand({
  action,
  argv = [],
  readLock,
  unlockSync,
  resolveCapability,
  stdout = process.stdout,
} = {}) {
  const options = parseCliOptions(argv);

  if (action === "sync-status") {
    const capability = resolveCapability?.() ?? {};
    const read = requireReadLock(readLock ?? capability.readLock);
    const periods = options.period ? [options.period] : ["daily", "yearly"];
    const payload = { locks: await Promise.all(periods.map((period) => read(period))) };
    stdout.write(formatJson(payload));
    return payload;
  }

  if (!["daily", "yearly"].includes(options.period)) {
    throw new Error("kline unlock requires --period daily|yearly.");
  }
  const capability = resolveCapability?.() ?? {};
  const unlock = requireUnlockSync(unlockSync ?? capability.unlockSync);
  const payload = await unlock(options.period, { force: Boolean(options.force) });
  stdout.write(formatJson(payload));
  return payload;
}

function createKlineSyncControlCommand({
  readLock,
  unlockSync,
  capability,
  createCapability,
  stdout = process.stdout,
} = {}) {
  let defaultCapability;
  function resolveCapability() {
    if (capability) return capability;
    if (createCapability) return createCapability();
    defaultCapability ??= require("../../../kline/sync_lock");
    return defaultCapability;
  }

  return (action, argv = []) => runKlineSyncControlCommand({
    action,
    argv,
    readLock,
    unlockSync,
    resolveCapability,
    stdout,
  });
}

module.exports = {
  createKlineSyncControlCommand,
  formatJson,
  runKlineSyncControlCommand,
};
