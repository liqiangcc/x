"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { normalizeProxy } = require("../model");
const { parseProxyList } = require("./proxypool");

const ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_REPOSITORY = "proxifly/free-proxy-list";
const DEFAULT_REF = "main";
const DEFAULT_PATH = "proxies/countries/CN/data.json";
const DEFAULT_CACHE_FILE = path.join(ROOT, "var/proxy-pool/github-cn.json");

function validateRepository(value) {
  const repository = String(value ?? DEFAULT_REPOSITORY).trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("GitHub proxy repository must use owner/name.");
  return repository;
}

function validateRepositoryPath(value) {
  const filePath = String(value ?? DEFAULT_PATH).trim();
  if (!filePath || filePath.startsWith("/") || filePath.split("/").includes("..")) throw new Error("GitHub proxy path must be repository-relative.");
  return filePath;
}

function parseGithubCnProxies(payload, repository = DEFAULT_REPOSITORY) {
  if (!Array.isArray(payload)) throw new Error("GitHub CN proxy payload must be an array.");
  const endpoints = payload.filter((item) => item?.geolocation?.country === "CN"
      && item.protocol === "http"
      && item.https === true)
    .map((item) => {
      try {
        const url = new URL(item.proxy);
        return url.protocol === "http:" ? `${url.hostname}:${url.port}` : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return parseProxyList(endpoints.join("\n")).map((endpoint) => normalizeProxy(endpoint, {
    protocol: "http",
    region: "CN",
    source: `github:${repository}`,
  }));
}

async function readCache(cacheFile) {
  try {
    return JSON.parse(await fs.readFile(cacheFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeCache(cacheFile, payload) {
  await fs.mkdir(path.dirname(cacheFile), { recursive: true });
  const temporary = `${cacheFile}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.rename(temporary, cacheFile);
}

class GithubProxyRepositoryProvider {
  constructor({
    cacheFile = process.env.X_PROXY_GITHUB_CACHE ?? DEFAULT_CACHE_FILE,
    fetchImpl = fetch,
    filePath = process.env.X_PROXY_GITHUB_PATH ?? DEFAULT_PATH,
    maxStaleMs = 6 * 60 * 60 * 1000,
    ref = process.env.X_PROXY_GITHUB_REF ?? DEFAULT_REF,
    repository = process.env.X_PROXY_GITHUB_REPO ?? DEFAULT_REPOSITORY,
    timeoutMs = 5000,
    token = process.env.GITHUB_TOKEN ?? "",
  } = {}) {
    this.cacheFile = path.resolve(cacheFile);
    this.fetchImpl = fetchImpl;
    this.filePath = validateRepositoryPath(filePath);
    this.maxStaleMs = maxStaleMs;
    this.ref = String(ref).trim() || DEFAULT_REF;
    this.repository = validateRepository(repository);
    this.timeoutMs = timeoutMs;
    this.token = token;
    this.lastReport = null;
  }

  async listCandidates() {
    const cached = await readCache(this.cacheFile);
    const url = `https://api.github.com/repos/${this.repository}/contents/${this.filePath.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(this.ref)}`;
    const headers = {
      Accept: "application/vnd.github+json",
      "User-Agent": "x-data-ledger",
    };
    if (cached?.etag) headers["If-None-Match"] = cached.etag;
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    try {
      const response = await this.fetchImpl(url, { headers, signal: AbortSignal.timeout(this.timeoutMs) });
      if (response.status === 304 && cached) {
        const proxies = parseGithubCnProxies(cached.items, this.repository);
        this.lastReport = { cache: "validated", count: proxies.length, repository: this.repository, sha: cached.sha };
        return proxies;
      }
      if (!response.ok) throw new Error(`GitHub contents API returned HTTP ${response.status}`);
      const body = await response.json();
      if (body.encoding !== "base64" || typeof body.content !== "string") throw new Error("GitHub contents API returned unsupported content encoding.");
      const items = JSON.parse(Buffer.from(body.content.replaceAll("\n", ""), "base64").toString("utf8"));
      const proxies = parseGithubCnProxies(items, this.repository);
      const cache = {
        version: 1,
        repository: this.repository,
        ref: this.ref,
        path: this.filePath,
        sha: body.sha ?? null,
        etag: response.headers.get("etag"),
        fetched_at: new Date().toISOString(),
        items,
      };
      await writeCache(this.cacheFile, cache);
      this.lastReport = { cache: "updated", count: proxies.length, repository: this.repository, sha: cache.sha };
      return proxies;
    } catch (error) {
      const fetchedAt = Date.parse(cached?.fetched_at ?? "");
      if (cached && Number.isFinite(fetchedAt) && Date.now() - fetchedAt <= this.maxStaleMs) {
        const proxies = parseGithubCnProxies(cached.items, this.repository);
        this.lastReport = { cache: "stale-fallback", count: proxies.length, error: error.message, repository: this.repository, sha: cached.sha };
        return proxies;
      }
      throw error;
    }
  }
}

module.exports = {
  DEFAULT_CACHE_FILE,
  DEFAULT_PATH,
  DEFAULT_REF,
  DEFAULT_REPOSITORY,
  GithubProxyRepositoryProvider,
  parseGithubCnProxies,
  readCache,
  validateRepository,
  validateRepositoryPath,
};
