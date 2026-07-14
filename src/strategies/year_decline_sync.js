"use strict";

const path = require("node:path");
const { buildCodeUniverse, normalizeDate } = require("../kline/code_universe");
const { splitSecid } = require("../core/secid");
const { ExistingKlineRepository } = require("../simulator/adapters/ledger/existing_kline_repository");
const { hasEligibleYear } = require("./year_decline");
const { marketBoardAllowed, marketBoardsFromList } = require("../core/market_board");

const STRATEGY_ID = "year-decline-close-breakout";

async function buildYearDeclineUniverse({
  asOfDate,
  codes,
  concurrency = 32,
  downTransitions = 3,
  force = false,
  klineRoot = path.join("data", "kline"),
  marketBoards = null,
  outputFile = null,
  strategyId = STRATEGY_ID,
} = {}) {
  const date = normalizeDate(asOfDate);
  const targetYear = Number(date.slice(0, 4));
  const repository = new ExistingKlineRepository({ cacheSize: Math.max(256, concurrency * 2), klineRoot });
  const marketScope = marketBoards === null ? null : marketBoardsFromList(marketBoards);
  const result = await buildCodeUniverse({
    asOfDate: date,
    codes,
    concurrency,
    force,
    outputFile,
    selector: { algorithm: STRATEGY_ID, id: strategyId, downTransitions, marketBoards: marketScope, targetYear },
    evaluateCode: async (inputCode) => {
      let security;
      try {
        security = splitSecid(inputCode);
      } catch {
        return { eligible: false, reason: "invalid_code" };
      }
      if (marketScope && !marketBoardAllowed(security, marketScope)) {
        return { eligible: false, reason: "market_scope_excluded" };
      }
      const history = await repository.getLegacyHistory({
        ...security,
        endDate: `${targetYear - 1}-12-31`,
        period: "yearly",
      });
      if (history.bars.length === 0) return { eligible: false, reason: "missing_yearly" };
      return {
        eligible: hasEligibleYear(history.bars, [targetYear], downTransitions),
        reason: "year_decline_not_matched",
      };
    },
  });
  const missingYearlyCodes = result.excluded_codes.missing_yearly ?? [];
  const invalidCodes = result.excluded_codes.invalid_code ?? [];
  return {
    ...result,
    target_year: targetYear,
    down_transitions: downTransitions,
    required_completed_years: downTransitions + 1,
    missing_yearly_count: missingYearlyCodes.length,
    invalid_code_count: invalidCodes.length,
    missing_yearly_codes: missingYearlyCodes,
    invalid_codes: invalidCodes,
    todo: missingYearlyCodes.length > 0
      ? "Backfill yearly history separately; missing codes are intentionally excluded from today's strategy sync."
      : null,
  };
}

module.exports = {
  STRATEGY_ID,
  buildYearDeclineUniverse,
};
