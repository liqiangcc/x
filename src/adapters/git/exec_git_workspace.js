"use strict";

const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
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

function requireRoot(root) {
  const value = String(root ?? "").trim();
  if (!value) throw new TypeError("root is required.");
  return path.resolve(value);
}

function createExecGitDataWorkspace({ root } = {}) {
  const cwd = requireRoot(root);

  return {
    existingPathspecs(candidates) {
      return existingPathspecs(cwd, candidates);
    },

    async status({ pathspec = [] } = {}) {
      const { stdout } = await execFileAsync(
        "git",
        ["status", "--short", "--", ...pathspec],
        { cwd }
      );
      return stdout;
    },

    async stage({ pathspec = [] } = {}) {
      await execFileAsync("git", ["add", "--", ...pathspec], { cwd });
    },

    stagedFiles({ pathspec = [] } = {}) {
      return stagedFiles(cwd, pathspec);
    },

    async commit({ files = [], title, body } = {}) {
      await execFileAsync(
        "git",
        ["commit", "-m", title, "-m", body, "--", ...files],
        { cwd, maxBuffer: 20 * 1024 * 1024 }
      );
    },
  };
}

module.exports = {
  createExecGitDataWorkspace,
  existingPathspecs,
  hasDiff,
  requireRoot,
  stagedFiles,
};
