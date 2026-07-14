"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { GithubProxyRepositoryProvider, parseGithubCnProxies } = require("../src/proxy/providers/github_repository");

const ITEMS = [
  { proxy: "http://1.2.3.4:8080", protocol: "http", https: true, geolocation: { country: "CN" } },
  { proxy: "http://2.3.4.5:8080", protocol: "http", https: false, geolocation: { country: "CN" } },
  { proxy: "socks5://3.4.5.6:1080", protocol: "socks5", https: true, geolocation: { country: "CN" } },
  { proxy: "http://4.5.6.7:8080", protocol: "http", https: true, geolocation: { country: "US" } },
];

test("GitHub provider accepts only CN HTTP proxies supporting HTTPS tunnels", () => {
  const proxies = parseGithubCnProxies(ITEMS, "owner/repo");
  assert.deepEqual(proxies.map((proxy) => proxy.endpoint), ["1.2.3.4:8080"]);
  assert.equal(proxies[0].source, "github:owner/repo");
});

test("GitHub provider updates its cache and reuses it after a 304", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "github-proxies-"));
  const cacheFile = path.join(dir, "cache.json");
  let requests = 0;
  const fetchImpl = async (_url, options) => {
    requests += 1;
    if (requests === 2) {
      assert.equal(options.headers["If-None-Match"], "etag-a");
      return new Response(null, { status: 304 });
    }
    return new Response(JSON.stringify({ encoding: "base64", content: Buffer.from(JSON.stringify(ITEMS)).toString("base64"), sha: "sha-a" }), {
      status: 200,
      headers: { "content-type": "application/json", etag: "etag-a" },
    });
  };
  const provider = new GithubProxyRepositoryProvider({ cacheFile, fetchImpl, repository: "owner/repo" });
  assert.equal((await provider.listCandidates()).length, 1);
  assert.equal(provider.lastReport.cache, "updated");
  assert.equal((await provider.listCandidates()).length, 1);
  assert.equal(provider.lastReport.cache, "validated");
});

test("GitHub provider falls back to a recent cache on network errors", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "github-proxies-"));
  const cacheFile = path.join(dir, "cache.json");
  await fs.writeFile(cacheFile, JSON.stringify({ fetched_at: new Date().toISOString(), items: ITEMS, sha: "cached" }));
  const provider = new GithubProxyRepositoryProvider({ cacheFile, fetchImpl: async () => { throw new Error("offline"); } });
  assert.equal((await provider.listCandidates()).length, 1);
  assert.equal(provider.lastReport.cache, "stale-fallback");
});
