"use strict";

const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");
const { existingPathspecs, stagedFiles } = require("../src/core/git");

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync("git", args, { cwd: repo, maxBuffer: 20 * 1024 * 1024 });
}

test("stagedFiles returns changed files and excludes empty data directories", async (t) => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "x-git-core-"));
  t.after(() => fs.rm(repo, { recursive: true, force: true }));

  await git(repo, ["init"]);
  await git(repo, ["config", "user.name", "Test User"]);
  await git(repo, ["config", "user.email", "test@example.com"]);
  await fs.mkdir(path.join(repo, "data"), { recursive: true });
  await fs.mkdir(path.join(repo, "reports"), { recursive: true });
  await fs.writeFile(path.join(repo, "data", "sample.json"), "{}\n", "utf8");

  await git(repo, ["add", "--", "data", "reports"]);

  const pathspec = await existingPathspecs(repo);
  assert.deepEqual(pathspec, ["data", "reports"]);
  assert.deepEqual(await stagedFiles(repo, pathspec), ["data/sample.json"]);

  await git(repo, ["commit", "-m", "data: sample", "--", ...(await stagedFiles(repo, pathspec))]);
});
