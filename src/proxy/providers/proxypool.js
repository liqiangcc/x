"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { normalizeProxy } = require("../model");

const ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_POOL_URL = "http://127.0.0.1:5555";
const DEFAULT_ENV_FILE = path.join(ROOT, "ops/proxy-pool/.env");

function parseProxyList(text) {
  return [...new Set(String(text ?? "").split(/\s+/).map((item) => item.trim())
    .filter((item) => /^(?:\d{1,3}\.){3}\d{1,3}:\d{1,5}$/.test(item))
    .filter((item) => {
      const [host, portText] = item.split(":");
      return host.split(".").every((octet) => Number(octet) >= 0 && Number(octet) <= 255) &&
        Number(portText) >= 1 && Number(portText) <= 65535;
    }))];
}

async function readLocalPoolEnv(envFile = DEFAULT_ENV_FILE) {
  try {
    const content = await fs.readFile(envFile, "utf8");
    return Object.fromEntries(content.split(/\r?\n/).map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

class ProxyPoolProvider {
  constructor(options = {}) { this.options = options; }

  async listCandidates(context = {}) {
    const options = { ...this.options, ...context };
    const localEnv = options.apiKey ? {} : await readLocalPoolEnv(options.envFile);
    const apiKey = options.apiKey || localEnv.PROXY_POOL_API_KEY || "";
    let poolUrl = options.poolUrl ?? process.env.X_PROXY_POOL_URL ?? DEFAULT_POOL_URL;
    if (poolUrl === DEFAULT_POOL_URL && localEnv.PROXY_POOL_PORT) poolUrl = `http://127.0.0.1:${localEnv.PROXY_POOL_PORT}`;
    const pathname = options.all ? "/all" : "/random";
    const url = new URL(pathname, `${String(poolUrl).replace(/\/+$/, "")}/`);
    url.searchParams.set("area", options.region ?? "CN");
    if (!options.all) url.searchParams.set("count", String(options.count ?? 50));
    const fetchImpl = options.fetchImpl ?? fetch;
    const headers = apiKey ? { "API-KEY": apiKey } : {};
    const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(options.apiTimeoutMs ?? 5000) });
    if (!response.ok) {
      if (response.status === 500) {
        const countResponse = await fetchImpl(new URL("/count", `${String(poolUrl).replace(/\/+$/, "")}/`), {
          headers,
          signal: AbortSignal.timeout(options.apiTimeoutMs ?? 5000),
        });
        if (countResponse.ok && Number(await countResponse.text()) === 0) return [];
      }
      throw new Error(`ProxyPool API returned HTTP ${response.status}`);
    }
    return parseProxyList(await response.text()).map((endpoint) => normalizeProxy(endpoint, {
      protocol: "http", region: options.region ?? "CN", source: "proxypool",
    }));
  }
}

module.exports = { DEFAULT_ENV_FILE, DEFAULT_POOL_URL, ProxyPoolProvider, parseProxyList, readLocalPoolEnv };
