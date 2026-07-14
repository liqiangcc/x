"use strict";

const path = require("node:path");
const { buildCodeUniverse, normalizeDate } = require("../kline/code_universe");
const { splitSecid } = require("../core/secid");
const { ExistingKlineRepository } = require("../simulator/adapters/ledger/existing_kline_repository");
const { marketBoardAllowed, marketBoardsFromList } = require("../core/market_board");
const { compileStrategy } = require("./strategy_builder");

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
  return buildStrategyUniverse({
    asOfDate,
    codes,
    concurrency,
    force,
    klineRoot,
    marketBoards,
    outputFile,
    strategyDefinition: { downTransitions, type: "year_decline_close_breakout" },
    strategyId,
  });
}

async function buildStrategyUniverse({
  asOfDate,
  codes,
  concurrency = 32,
  force = false,
  klineRoot = path.join("data", "kline"),
  marketBoards = null,
  outputFile = null,
  strategyDefinition,
  strategyId = STRATEGY_ID,
} = {}) {
  const date = normalizeDate(asOfDate);
  const targetYear = Number(date.slice(0, 4));
  const compiled = compileStrategy(strategyDefinition);
  const repository = new ExistingKlineRepository({ cacheSize: Math.max(256, concurrency * 2), klineRoot });
  const marketScope = marketBoards === null ? null : marketBoardsFromList(marketBoards);
  const result = await buildCodeUniverse({
    asOfDate: date,
    codes,
    concurrency,
    force,
    outputFile,
    selector: { algorithm: "compiled-strategy-prefilter", definition: compiled.definition, id: strategyId, marketBoards: marketScope, targetYear },
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
      if (!compiled.hasYearlyPrefilter) return { eligible: true };
      const history = await repository.getLegacyHistory({
        ...security,
        endDate: `${targetYear - 1}-12-31`,
        period: "yearly",
      });
      if (history.bars.length === 0) return { eligible: false, reason: "missing_yearly" };
      return {
        eligible: compiled.yearlyPrefilter(history.bars.map((bar) => ({ ...bar, year: Number(bar.date.slice(0, 4)) }))),
        reason: "strategy_prefilter_not_matched",
      };
    },
  });
  const missingYearlyCodes = result.excluded_codes.missing_yearly ?? [];
  const invalidCodes = result.excluded_codes.invalid_code ?? [];
  const downTransitions = strategyDefinition?.downTransitions
    ?? strategyDefinition?.rules?.find((rule) => rule.type === "sequence_compare")?.params?.transitions
    ?? null;
  return {
    ...result,
    target_year: targetYear,
    strategy_description: compiled.description,
    down_transitions: downTransitions,
    required_completed_years: Number.isInteger(downTransitions) ? downTransitions + 1 : null,
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
  buildStrategyUniverse,
  buildYearDeclineUniverse,
};
