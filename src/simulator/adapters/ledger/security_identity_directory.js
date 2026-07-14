"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { normalizeSecurityId, securityKey } = require("../../core/contracts");

class SecurityIdentityDirectory {
  constructor({ universeRoot = path.join("data", "universe") } = {}) {
    this.signature = null;
    this.universeRoot = universeRoot;
    this.values = new Map();
  }

  #refresh() {
    const summaryPath = path.join(this.universeRoot, "summary.json");
    let summary;
    let stat;
    try {
      stat = fs.statSync(summaryPath);
      const signature = `${stat.mtimeMs}:${stat.size}`;
      if (signature === this.signature) return;
      summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
      const stocksPath = path.join(this.universeRoot, String(summary.date), "stocks.json");
      const payload = JSON.parse(fs.readFileSync(stocksPath, "utf8"));
      const values = new Map();
      for (const stock of payload.stocks ?? []) {
        const security = normalizeSecurityId({ code: stock.code, market: stock.market_id });
        values.set(securityKey(security), {
          code: security.code,
          market: security.market,
          name: typeof stock.name === "string" && stock.name.trim() ? stock.name.trim() : null,
        });
      }
      this.values = values;
      this.signature = signature;
    } catch {
      // Identity is optional metadata. Trading remains available when a snapshot is absent.
    }
  }

  lookup(value) {
    const security = normalizeSecurityId(value);
    this.#refresh();
    return { code: security.code, market: security.market, name: this.values.get(securityKey(security))?.name ?? null };
  }
}

module.exports = { SecurityIdentityDirectory };
