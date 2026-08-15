"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createProxyPoolRefreshGithubCommand,
  runProxyPoolRefreshGithubCommand,
} = require("../src/adapters/cli/commands/proxy_pool_refresh_github");

function memoryStream() {
  let output = "";
  return {
    stream: { write(chunk) { output += chunk; } },
    read() { return output; },
  };
}

test("proxy pool refresh-github maps CLI options to the existing provider and prints its report", async () => {
  const output = memoryStream();
  let providerOptions;
  const provider = {
    lastReport: null,
    async listCandidates() {
      this.lastReport = {
        cache: "updated",
        count: 2,
        repository: "owner/repo",
        sha: "sha-a",
      };
      return [{ endpoint: "1.2.3.4:80" }, { endpoint: "2.3.4.5:80" }];
    },
  };

  const report = await runProxyPoolRefreshGithubCommand({
    argv: [
      "--repository", "owner/repo",
      "--ref", "dev",
      "--path", "proxies/cn.json",
      "--timeout-ms", "1234",
    ],
    createProvider(options) {
      providerOptions = options;
      return provider;
    },
    stdout: output.stream,
  });

  assert.deepEqual(providerOptions, {
    filePath: "proxies/cn.json",
    ref: "dev",
    repository: "owner/repo",
    timeoutMs: 1234,
  });
  assert.deepEqual(report, {
    ok: true,
    cache: "updated",
    count: 2,
    repository: "owner/repo",
    sha: "sha-a",
    candidate_count: 2,
  });
  assert.equal(output.read(), `${JSON.stringify(report, null, 2)}\n`);
});

test("proxy pool refresh-github keeps provider construction lazy until protocol validation succeeds", async () => {
  let created = 0;
  const command = createProxyPoolRefreshGithubCommand({
    createProvider() {
      created += 1;
      return { lastReport: {}, async listCandidates() { return []; } };
    },
  });

  await assert.rejects(
    command(["--timeout-ms", "0"]),
    /--timeout-ms must be a positive integer\./,
  );
  assert.equal(created, 0);

  await assert.rejects(
    command(["--timeout-ms"]),
    /Missing value for --timeout-ms/,
  );
  assert.equal(created, 0);
});

test("proxy pool refresh-github preserves the legacy timeout default", async () => {
  let providerOptions;
  const output = memoryStream();
  await runProxyPoolRefreshGithubCommand({
    argv: [],
    createProvider(options) {
      providerOptions = options;
      return {
        lastReport: { cache: "validated", count: 0, repository: "default/repo", sha: null },
        async listCandidates() { return []; },
      };
    },
    stdout: output.stream,
  });

  assert.deepEqual(providerOptions, {
    filePath: undefined,
    ref: undefined,
    repository: undefined,
    timeoutMs: 5000,
  });
});

test("proxy pool refresh-github propagates provider failures without rewriting them", async () => {
  const expected = new Error("GitHub contents API returned HTTP 503");
  await assert.rejects(
    runProxyPoolRefreshGithubCommand({
      createProvider() {
        return {
          lastReport: null,
          async listCandidates() { throw expected; },
        };
      },
    }),
    (error) => error === expected,
  );
});
