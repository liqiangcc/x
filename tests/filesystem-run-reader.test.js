"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  artifactPath,
  createFilesystemRunReader,
} = require("../src/adapters/ledger/filesystem_run_reader");

test("filesystem run reader lists directories and reads controlled artifacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "x-runs-"));
  const runsDir = path.join(root, "runs");
  try {
    await fs.mkdir(path.join(runsDir, "run-b"), { recursive: true });
    await fs.mkdir(path.join(runsDir, "run-a"), { recursive: true });
    await fs.writeFile(path.join(runsDir, "not-a-run.txt"), "ignore", "utf8");
    await fs.writeFile(path.join(runsDir, "run-a", "run.json"), "run-content\n", "utf8");
    await fs.writeFile(path.join(runsDir, "run-a", "failures.json"), "failure-content\n", "utf8");

    const reader = createFilesystemRunReader({ runsDir });
    assert.deepEqual((await reader.listRunIds()).sort(), ["run-a", "run-b"]);
    assert.equal(
      await reader.readArtifact({ artifact: "run", runId: "run-a" }),
      "run-content\n"
    );
    assert.equal(
      await reader.readArtifact({ artifact: "failures", runId: "run-a" }),
      "failure-content\n"
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("filesystem run reader treats a missing runs directory as an empty ledger", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "x-runs-missing-"));
  try {
    const reader = createFilesystemRunReader({ runsDir: path.join(root, "missing") });
    assert.deepEqual(await reader.listRunIds(), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("filesystem run reader only maps supported artifacts inside runsDir", () => {
  const runsDir = path.resolve("/tmp/x-runs-safe");
  assert.equal(
    artifactPath(runsDir, "run-a", "run"),
    path.join(runsDir, "run-a", "run.json")
  );
  assert.throws(() => artifactPath(runsDir, "run-a", "quality"), /Unsupported run artifact/);
  assert.throws(() => artifactPath(runsDir, "../outside", "run"), /outside runsDir/);
});
