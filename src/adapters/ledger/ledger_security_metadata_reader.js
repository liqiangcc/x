"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  assertSecurityMetadataReader,
} = require("../../ports/market/security_metadata_reader");

function normalizeSecurity(value) {
  const code = String(value?.code ?? "").trim();
  const market = Number(value?.market);
  if (!/^\d{6}$/.test(code)) throw new TypeError("security.code must be a six-digit code.");
  if (!Number.isInteger(market) || market < 0) {
    throw new TypeError("security.market must be a non-negative integer.");
  }
  return Object.freeze({ code, market });
}

function securityKey({ code, market }) {
  return `${market}.${code}`;
}

class LedgerSecurityMetadataReader {
  constructor({ universeRoot = path.join("data", "universe") } = {}) {
    this.universeRoot = universeRoot;
    this.signature = null;
    this.values = new Map();
  }

  #refresh() {
    const summaryPath = path.join(this.universeRoot, "summary.json");
    try {
      const stat = fs.statSync(summaryPath);
      const signature = `${stat.mtimeMs}:${stat.size}`;
      if (signature === this.signature) return;

      const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
      if (summary.market !== "hs-a" || !summary.date) {
        this.values = new Map();
        this.signature = signature;
        return;
      }
      const stocksPath = path.join(this.universeRoot, String(summary.date), "stocks.json");
      const payload = JSON.parse(fs.readFileSync(stocksPath, "utf8"));
      const values = new Map();
      for (const stock of payload.stocks ?? []) {
        const security = normalizeSecurity({ code: stock.code, market: stock.market_id });
        values.set(securityKey(security), Object.freeze({
          instrumentType: "a_share",
          intradayRoundTripEligible: false,
          source: Object.freeze({
            kind: "repo_universe",
            market: "hs-a",
            date: String(summary.date),
          }),
        }));
      }
      this.values = values;
      this.signature = signature;
    } catch {
      // Security metadata is optional repository context. The caller decides
      // whether missing metadata is acceptable or must fail closed.
      this.values = new Map();
      this.signature = null;
    }
  }

  readMetadata(value) {
    const security = normalizeSecurity(value);
    this.#refresh();
    return this.values.get(securityKey(security)) ?? null;
  }
}

assertSecurityMetadataReader(new LedgerSecurityMetadataReader({ universeRoot: path.join("__missing__") }));

module.exports = {
  LedgerSecurityMetadataReader,
  normalizeSecurity,
  securityKey,
};
