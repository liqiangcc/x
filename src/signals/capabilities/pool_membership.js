"use strict";

function evaluatePoolMembership(context, params = {}) {
  const pool = String(params.pool ?? "").trim();
  const pools = Array.isArray(context?.pools) ? context.pools : [];
  return {
    evidence: {
      pool,
      pools,
    },
    ok: Boolean(pool && pools.includes(pool)),
    qualityIssues: [],
  };
}

module.exports = {
  evaluatePoolMembership,
};
