"use strict";

const crypto = require("node:crypto");
const { normalizeSecurityId, securityKey } = require("../core/contracts");

function aliasSuffix(index) {
  let value = index + 1;
  let suffix = "";
  while (value > 0) {
    value -= 1;
    suffix = String.fromCharCode(65 + (value % 26)) + suffix;
    value = Math.floor(value / 26);
  }
  return suffix;
}

function keyedHash(salt, value) {
  return crypto.createHmac("sha256", salt).update(value).digest("hex");
}

class CandidateAliasRegistry {
  #byCandidateId = new Map();
  #bySecurityKey = new Map();
  #salt;

  constructor({ salt = crypto.randomBytes(32) } = {}) {
    this.#salt = Buffer.from(salt);
  }

  register(securities) {
    const normalized = securities.map(normalizeSecurityId);
    const shuffled = normalized
      .filter((security) => !this.#bySecurityKey.has(securityKey(security)))
      .map((security) => ({ security, sortKey: keyedHash(this.#salt, `alias:${securityKey(security)}`) }))
      .sort((left, right) => left.sortKey.localeCompare(right.sortKey));

    const firstAliasIndex = this.#bySecurityKey.size;
    for (const [index, item] of shuffled.entries()) {
      const key = securityKey(item.security);
      const candidateId = `cand_${keyedHash(this.#salt, `id:${key}`).slice(0, 24)}`;
      const record = Object.freeze({
        alias: `候选${aliasSuffix(firstAliasIndex + index)}`,
        candidateId,
        security: Object.freeze({ ...item.security }),
      });
      this.#byCandidateId.set(candidateId, record);
      this.#bySecurityKey.set(key, record);
    }
    return normalized.map((security) => this.publicForSecurity(security));
  }

  publicForSecurity(security) {
    const record = this.#bySecurityKey.get(securityKey(normalizeSecurityId(security)));
    return record ? { alias: record.alias, candidateId: record.candidateId } : null;
  }

  resolve(candidateId) {
    const record = this.#byCandidateId.get(String(candidateId));
    return record ? { ...record.security } : null;
  }

  records() {
    return [...this.#byCandidateId.values()].map((record) => ({
      alias: record.alias, candidateId: record.candidateId, security: { ...record.security },
    }));
  }

  restore(records) {
    for (const source of records) {
      const security = normalizeSecurityId(source.security);
      const record = Object.freeze({ alias: source.alias, candidateId: source.candidateId, security: Object.freeze(security) });
      this.#byCandidateId.set(record.candidateId, record);
      this.#bySecurityKey.set(securityKey(security), record);
    }
    return this;
  }
}

module.exports = {
  CandidateAliasRegistry,
  aliasSuffix,
  keyedHash,
};
