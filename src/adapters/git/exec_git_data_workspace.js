"use strict";

const { execFile } = require("node:child_process");
const path = require("node:path");
const { promisify } = require("node:util");
const {
  existingPathspecs,
  stagedFiles,
} = require("../../core/git");

const execFileAsync = promisify(execFile);

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
  requireRoot,
};
