"use strict";

const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");
const test = require("node:test");

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, "..");
const BIN = path.join(ROOT, "bin", "x");

async function runCli(args) {
  return execFileAsync(process.execPath, [BIN, ...args], {
    cwd: ROOT,
    maxBuffer: 1024 * 1024,
  });
}

test("bin/x run list, show, and failures preserve the read-only CLI contract", async () => {
  const runId = `__cli_run_contract_${process.pid}`;
  const runDir = path.join(ROOT, "runs", runId);
  const runContent = "{\"run_id\":\"contract\",\"status\":\"completed\"}\n";
  const failuresContent = "{\"failed\":0,\"items\":[]}\n";

  try {
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(path.join(runDir, "run.json"), runContent, "utf8");
    await fs.writeFile(path.join(runDir, "failures.json"), failuresContent, "utf8");

    const listed = await runCli(["run", "list"]);
    assert.equal(listed.stderr, "");
    assert.equal(listed.stdout.split(/\r?\n/).includes(runId), true);

    const shown = await runCli(["run", "show", runId]);
    assert.equal(shown.stderr, "");
    assert.equal(shown.stdout, runContent);

    const failures = await runCli(["run", "failures", runId]);
    assert.equal(failures.stderr, "");
    assert.equal(failures.stdout, failuresContent);

    await assert.rejects(
      () => runCli(["run", "show", "../outside"]),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /outside runsDir/);
        return true;
      }
    );
  } finally {
    await fs.rm(runDir, { recursive: true, force: true });
  }
});
