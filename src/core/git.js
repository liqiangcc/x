"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

async function existingPathspecs(root, candidates = ["data", "runs", "reports"]) {
  const existing = [];
  for (const candidate of candidates) {
    try {
      await fs.access(path.join(root, candidate));
      existing.push(candidate);
    } catch {}
  }
  return existing;
}

async function hasDiff(root, pathspec) {
  if (pathspec.length === 0) {
    return false;
  }

  try {
    await execFileAsync("git", ["diff", "--quiet", "--", ...pathspec], { cwd: root });
    await execFileAsync("git", ["diff", "--cached", "--quiet", "--", ...pathspec], { cwd: root });
    return false;
  } catch {
    return true;
  }
}

async function stagedFiles(root, pathspec) {
  if (pathspec.length === 0) {
    return [];
  }

  const { stdout } = await execFileAsync(
    "git",
    ["diff", "--cached", "--name-only", "--", ...pathspec],
    { cwd: root, maxBuffer: 20 * 1024 * 1024 }
  );
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

module.exports = {
  existingPathspecs,
  hasDiff,
  stagedFiles,
};
