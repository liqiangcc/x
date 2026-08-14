"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  createProxyPoolVerifier,
} = require("../src/adapters/proxy/proxy_pool_verifier");
const {
  createFilesystemProxyVerificationReportWriter,
} = require("../src/adapters/proxy/filesystem_proxy_verification_report_writer");

test("proxy pool verifier adapts options to the existing verification capability", async () => {
  let received;
  const expected = { available_count: 2, available: [] };
  const verifier = createProxyPoolVerifier({
    async validateAllProxiesImpl(options) {
      received = options;
      return expected;
    },
  });

  const result = await verifier.verify({ concurrency: 3, timeoutMs: 4500, limit: 7 });
  assert.deepEqual(received, { concurrency: 3, timeoutMs: 4500, limit: 7 });
  assert.equal(result, expected);
});

test("filesystem proxy verification writer preserves default run layout and file shapes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-verify-writer-"));
  try {
    const report = {
      available_count: 2,
      available: [
        { proxy: "2.2.2.2:80", duration_ms: 20 },
        { proxy: "1.1.1.1:80", duration_ms: 30 },
      ],
    };
    const writer = createFilesystemProxyVerificationReportWriter({
      root,
      runsDir: path.join(root, "runs"),
      now: () => new Date("2026-08-15T00:01:02.345Z"),
    });

    const files = await writer.write({ report });
    assert.deepEqual(files, {
      report: "runs/proxy-verify/20260815T000102Z/report.json",
      available: "runs/proxy-verify/20260815T000102Z/available.txt",
    });
    assert.equal(
      await fs.readFile(path.join(root, files.report), "utf8"),
      `${JSON.stringify(report, null, 2)}\n`
    );
    assert.equal(
      await fs.readFile(path.join(root, files.available), "utf8"),
      "2.2.2.2:80\n1.1.1.1:80\n"
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("filesystem proxy verification writer keeps requested report path and empty available file", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-verify-custom-"));
  try {
    const report = { available_count: 0, available: [] };
    const writer = createFilesystemProxyVerificationReportWriter({ root });
    const files = await writer.write({
      output: "custom/proxy-report.json",
      report,
    });

    assert.deepEqual(files, {
      report: "custom/proxy-report.json",
      available: "custom/available.txt",
    });
    assert.equal(
      await fs.readFile(path.join(root, "custom/proxy-report.json"), "utf8"),
      `${JSON.stringify(report, null, 2)}\n`
    );
    assert.equal(await fs.readFile(path.join(root, "custom/available.txt"), "utf8"), "");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
