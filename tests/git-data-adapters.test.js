"use strict";

const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");
const {
  createExecGitDataWorkspace,
} = require("../src/adapters/git/exec_git_data_workspace");
const {
  createFilesystemRunCommitContextReader,
} = require("../src/adapters/ledger/filesystem_run_commit_context_reader");

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync("git", args, {
    cwd: repo,
    maxBuffer: 20 * 1024 * 1024,
  });
}

test("exec git data workspace scopes status, staging, and commit", async (t) => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "x-git-data-workspace-"));
  t.after(() => fs.rm(repo, { recursive: true, force: true }));

  await git(repo, ["init"]);
  await git(repo, ["config", "user.name", "Test User"]);
  await git(repo, ["config", "user.email", "test@example.com"]);
  await fs.mkdir(path.join(repo, "data"), { recursive: true });
  await fs.writeFile(path.join(repo, "data", "sample.json"), "{}\n", "utf8");

  const workspace = createExecGitDataWorkspace({ root: repo });
  assert.deepEqual(
    await workspace.existingPathspecs(["data", "runs", "reports"]),
    ["data"]
  );
  assert.match(await workspace.status({ pathspec: ["data"] }), /^\?\? data\//m);

  await workspace.stage({ pathspec: ["data"] });
  assert.deepEqual(
    await workspace.stagedFiles({ pathspec: ["data"] }),
    ["data/sample.json"]
  );
  await workspace.commit({
    body: "run_id: run-1\nquality: passed",
    files: ["data/sample.json"],
    title: "data(daily): 20260105 update pool kline",
  });

  const { stdout: subject } = await git(repo, ["log", "-1", "--pretty=%s"]);
  const { stdout: body } = await git(repo, ["log", "-1", "--pretty=%b"]);
  assert.equal(subject.trim(), "data(daily): 20260105 update pool kline");
  assert.match(body, /run_id: run-1/);
  assert.match(body, /quality: passed/);
});

test("filesystem run commit context reader preserves missing-quality fallback", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "x-run-commit-context-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const runsDir = path.join(root, "runs");
  const runDir = path.join(runsDir, "run-1");
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(
    path.join(runDir, "run.json"),
    `${JSON.stringify({ run_id: "run-1", date: "20260105" })}\n`,
    "utf8"
  );

  const reader = createFilesystemRunCommitContextReader({ runsDir });
  assert.deepEqual(await reader.readCommitContext({ runId: "run-1" }), {
    quality: { status: "recorded" },
    run: { run_id: "run-1", date: "20260105" },
  });

  await fs.writeFile(
    path.join(runDir, "quality.json"),
    `${JSON.stringify({ status: "passed" })}\n`,
    "utf8"
  );
  assert.deepEqual(await reader.readCommitContext({ runId: "run-1" }), {
    quality: { status: "passed" },
    run: { run_id: "run-1", date: "20260105" },
  });
});

test("filesystem run commit context reader preserves JSON parse failures", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "x-run-commit-json-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const runsDir = path.join(root, "runs");
  const runDir = path.join(runsDir, "run-1");
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, "run.json"), "{broken\n", "utf8");

  const reader = createFilesystemRunCommitContextReader({ runsDir });
  await assert.rejects(
    reader.readCommitContext({ runId: "run-1" }),
    SyntaxError
  );
});
