"use strict";

const {
  assertSecurityMasterReader,
  assertSecurityMasterSnapshotReader,
} = require("../../ports/market/security_master_reader");

function normalizeCode(value) {
  const code = String(value ?? "").trim();
  if (!/^\d{6}$/.test(code)) throw new TypeError("code must be a six-digit security code.");
  return code;
}

function optionalMarket(value) {
  if (value === null || value === undefined || value === "") return null;
  const market = Number(value);
  if (!Number.isInteger(market) || market < 0) {
    throw new TypeError("market must be a non-negative integer.");
  }
  return market;
}

function notFound(code, market, asOf) {
  const suffix = [
    market === null ? null : `market=${market}`,
    asOf ? `asOf=${asOf}` : null,
  ].filter(Boolean).join(", ");
  const error = new Error(`Security ${code}${suffix ? ` (${suffix})` : ""} was not found.`);
  error.code = "security_not_found";
  return error;
}

function uniqueIdentities(snapshot, code) {
  const identities = new Map();
  for (const entry of snapshot?.entries ?? []) {
    const security = entry?.record?.security;
    if (security?.code !== code) continue;
    identities.set(`${security.market}:${security.code}`, security);
  }
  return [...identities.values()];
}

class GetSecurityUseCase {
  constructor({ securityMasterReader } = {}) {
    this.securityMasterReader = assertSecurityMasterReader(securityMasterReader);
    assertSecurityMasterSnapshotReader(securityMasterReader);
  }

  async execute({ code, market = null, asOf = null } = {}) {
    const normalizedCode = normalizeCode(code);
    const normalizedMarket = optionalMarket(market);

    let record = null;
    if (normalizedMarket !== null) {
      record = this.securityMasterReader.readRecord(
        { code: normalizedCode, market: normalizedMarket },
        { asOf }
      );
    } else {
      const snapshot = this.securityMasterReader.readSnapshot();
      const candidates = uniqueIdentities(snapshot, normalizedCode)
        .map((security) => this.securityMasterReader.readRecord(security, { asOf }))
        .filter(Boolean);

      if (candidates.length > 1) {
        throw new TypeError(
          `market is required because security code ${normalizedCode} matches multiple markets.`
        );
      }
      record = candidates[0] ?? null;
    }

    if (!record) throw notFound(normalizedCode, normalizedMarket, asOf);

    return Object.freeze({
      security: Object.freeze({
        code: record.security.code,
        market: record.security.market,
        instrumentType: record.instrumentType,
        intradayRoundTripEligible: record.intradayRoundTripEligible,
      }),
      effectiveFrom: record.effectiveFrom,
      effectiveTo: record.effectiveTo,
      meta: Object.freeze({
        asOf: asOf ?? null,
        qualityIssues: record.qualityIssues,
        source: record.source,
      }),
    });
  }
}

module.exports = {
  GetSecurityUseCase,
  normalizeCode,
  optionalMarket,
  uniqueIdentities,
};
