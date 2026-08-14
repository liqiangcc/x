"use strict";

const SHARE_AVAILABILITY = Object.freeze({
  SAME_DAY: "same_day",
  NEXT_TRADING_DAY: "next_trading_day",
});
const RESTRICTION_RULE_KINDS = Object.freeze({
  NONE: "none",
  A_SHARE_MARKET: "a_share_market",
});

function nonEmptyString(value, field) {
  if (typeof value !== "string" || !value) {
    throw new TypeError(`execution profile ${field} must be a non-empty string.`);
  }
  return value;
}

function positiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`execution profile ${field} must be a positive integer.`);
  }
  return value;
}

function positiveNumber(value, field) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`execution profile ${field} must be positive.`);
  }
  return value;
}

function optionalNonNegativeNumber(value, field) {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`execution profile ${field} must be non-negative when provided.`);
  }
  return value;
}

function assertObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`execution profile ${field} must be an object.`);
  }
  return value;
}

function assertExecutionProfile(profile) {
  assertObject(profile, "value");
  for (const field of ["id", "assetClass", "kind", "ruleApproximation"]) {
    nonEmptyString(profile[field], field);
  }

  const settlement = assertObject(profile.settlement, "settlement");
  if (!Object.values(SHARE_AVAILABILITY).includes(settlement.sharesAvailable)) {
    throw new TypeError(`execution profile settlement.sharesAvailable must be one of: ${Object.values(SHARE_AVAILABILITY).join(", ")}.`);
  }

  const lotRules = assertObject(profile.lotRules, "lotRules");
  positiveInteger(lotRules.buyLotSize, "lotRules.buyLotSize");

  const priceRules = assertObject(profile.priceRules, "priceRules");
  positiveNumber(priceRules.tickSize, "priceRules.tickSize");
  optionalNonNegativeNumber(priceRules.slippageRate, "priceRules.slippageRate");

  const feeRules = assertObject(profile.feeRules, "feeRules");
  optionalNonNegativeNumber(feeRules.commissionRate, "feeRules.commissionRate");
  optionalNonNegativeNumber(feeRules.minimumCommissionYuan, "feeRules.minimumCommissionYuan");
  optionalNonNegativeNumber(feeRules.stampDutyRate, "feeRules.stampDutyRate");

  const restrictionRules = assertObject(profile.restrictionRules, "restrictionRules");
  if (!Object.values(RESTRICTION_RULE_KINDS).includes(restrictionRules.kind)) {
    throw new TypeError(`execution profile restrictionRules.kind must be one of: ${Object.values(RESTRICTION_RULE_KINDS).join(", ")}.`);
  }

  if (!Array.isArray(profile.qualityIssues) || profile.qualityIssues.some((issue) => typeof issue !== "string" || !issue)) {
    throw new TypeError("execution profile qualityIssues must be an array of non-empty strings.");
  }
  return profile;
}

function defineExecutionProfile(profile) {
  assertExecutionProfile(profile);
  const normalized = {
    id: profile.id,
    assetClass: profile.assetClass,
    kind: profile.kind,
    ruleApproximation: profile.ruleApproximation,
    settlement: Object.freeze({ ...profile.settlement }),
    lotRules: Object.freeze({ ...profile.lotRules }),
    priceRules: Object.freeze({ ...profile.priceRules }),
    feeRules: Object.freeze({ ...profile.feeRules }),
    restrictionRules: Object.freeze({ ...profile.restrictionRules }),
    qualityIssues: Object.freeze([...new Set(profile.qualityIssues)].sort()),
  };
  return Object.freeze(normalized);
}

module.exports = {
  RESTRICTION_RULE_KINDS,
  SHARE_AVAILABILITY,
  assertExecutionProfile,
  defineExecutionProfile,
};
