"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const LOCK_DIR = path.join(ROOT, "var/kline-sync/locks");

function lockFile(period) { return path.join(LOCK_DIR, `${period}.lock`); }

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function readLock(period) {
  const file = lockFile(period);
  try {
    const payload = JSON.parse(await fs.readFile(file, "utf8"));
    return { ...payload, file, alive: isProcessAlive(Number(payload.pid)) };
  } catch (error) {
    if (error.code === "ENOENT") return { file, alive: false, status: "unlocked" };
    return { file, alive: false, status: "invalid", error: error.message };
  }
}

async function acquireSyncLock(period) {
  await fs.mkdir(LOCK_DIR, { recursive: true });
  const file = lockFile(period);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fs.open(file, "wx");
      const payload = { period, pid: process.pid, started_at: new Date().toISOString() };
      await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`);
      await handle.close();
      return { file, pid: process.pid, async release() {
        const current = await readLock(period);
        if (Number(current.pid) === process.pid) await fs.rm(file, { force: true });
      } };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const current = await readLock(period);
      if (current.alive) throw new Error(`Another ${period} Kline sync is already running: PID ${current.pid}`);
      await fs.rm(file, { force: true });
    }
  }
  throw new Error(`Failed to acquire ${period} Kline sync lock.`);
}

async function unlockSync(period, { force = false } = {}) {
  const current = await readLock(period);
  if (current.alive && !force) throw new Error(`Refusing to unlock live ${period} sync PID ${current.pid}; use --force if intentional.`);
  await fs.rm(current.file, { force: true });
  return { ...current, removed: true };
}

module.exports = { acquireSyncLock, isProcessAlive, lockFile, readLock, unlockSync };
