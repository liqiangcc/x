"use strict";

const crypto = require("node:crypto");

function proxyId(endpoint) {
  return crypto.createHash("sha256").update(String(endpoint)).digest("hex").slice(0, 12);
}

function normalizeProxy(value, defaults = {}) {
  if (typeof value === "object" && value?.endpoint) {
    return { protocol: "http", region: "CN", source: "unknown", ...value, id: value.id ?? proxyId(value.endpoint) };
  }
  const endpoint = String(value);
  return {
    id: proxyId(endpoint),
    endpoint,
    protocol: defaults.protocol ?? "http",
    region: defaults.region ?? "CN",
    source: defaults.source ?? "unknown",
  };
}

module.exports = { normalizeProxy, proxyId };
