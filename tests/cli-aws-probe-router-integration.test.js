"use strict";

const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, "..");

test("real aws probe-router entry preserves missing secid protocol without network access", async () => {
  await assert.rejects(
    () => execFileAsync(process.execPath, ["bin/x", "aws", "probe-router"], {
      cwd: ROOT,
      env: { ...process.env, AWS_ROUTER_URL: "", AWS_ROUTER_TOKEN: "" },
    }),
    (error) => {
      assert.equal(error.code, 1);
      assert.equal(error.stdout, "");
      assert.match(
        error.stderr,
        /aws probe-router requires --secid <secid_or_code>\./
      );
      assert.doesNotMatch(error.stderr, /AWS_ROUTER_URL is required/);
      return true;
    }
  );
});

test("bin/x delegates probe-router instead of owning Router HTTP logic", async () => {
  const source = await fs.readFile(path.join(ROOT, "bin/x"), "utf8");
  assert.match(source, /createAwsProbeRouterCommand/);
  assert.match(source, /createAwsCommand/);
  assert.match(source, /probeRouterCommand: commandAwsProbeRouter/);
  assert.doesNotMatch(source, /async function commandAws\(/);
  assert.doesNotMatch(source, /async function commandAwsProbeRouter\(/);
  assert.doesNotMatch(source, /async function postRouterJson\(/);
});
