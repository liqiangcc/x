"use strict";

const fs = require("node:fs/promises");
const { getKline } = require("../sources/eastmoney/client");

const DEFAULT_CONFIG = "/opt/clash/runtime.yaml";
const DEFAULT_GROUP = "lx";

function parseProxyLine(line, groupName) {
  const nameMatch = line.match(/name:\s*([^,}]+)/);
  if (!nameMatch || nameMatch[1].trim() !== groupName) {
    return null;
  }
  const proxiesMatch = line.match(/proxies:\s*\[([^\]]*)\]/);
  if (!proxiesMatch) {
    return null;
  }
  return proxiesMatch[1]
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function listProxies({
  configFile = process.env.X_CLASH_CONFIG || DEFAULT_CONFIG,
  groupName = process.env.X_PROXY_GROUP_NAME || DEFAULT_GROUP,
} = {}) {
  const content = await fs.readFile(configFile, "utf8");
  for (const line of content.split("\n")) {
    const proxies = parseProxyLine(line, groupName);
    if (proxies) {
      return proxies;
    }
  }
  throw new Error(`Proxy group not found: ${groupName}`);
}

async function rotateProxy({
  proxyName = null,
  configFile = process.env.X_CLASH_CONFIG || DEFAULT_CONFIG,
  groupName = process.env.X_PROXY_GROUP_NAME || DEFAULT_GROUP,
} = {}) {
  const content = await fs.readFile(configFile, "utf8");
  const lines = content.split("\n");
  let updated = false;
  let selectedProxy = proxyName;
  const nextLines = lines.map((line) => {
    const proxies = parseProxyLine(line, groupName);
    if (!proxies) {
      return line;
    }
    selectedProxy = selectedProxy || proxies[Math.floor(Math.random() * proxies.length)];
    const sorted = [selectedProxy, ...proxies.filter((proxy) => proxy !== selectedProxy)];
    updated = true;
    return line.replace(/proxies:\s*\[[^\]]*\]/, `proxies: [${sorted.join(",")}]`);
  });

  if (!updated) {
    throw new Error(`Proxy group not found: ${groupName}`);
  }

  await fs.writeFile(configFile, nextLines.join("\n"), "utf8");
  return { proxy: selectedProxy, configFile, groupName };
}

async function checkEastmoneyAccess() {
  const payload = await getKline({
    secid: "1.600519",
    klt: "101",
    lmt: 1,
    end: "20991206",
  });
  return {
    ok: Array.isArray(payload?.data?.klines) && payload.data.klines.length > 0,
  };
}

module.exports = {
  checkEastmoneyAccess,
  listProxies,
  rotateProxy,
};
