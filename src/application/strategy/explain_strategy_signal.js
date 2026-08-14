"use strict";

const { assertSignalDetailReader } = require("../../ports/strategy/signal_reader");
const { projectSignalCandidate } = require("./signal_candidate_projection");
const {
  normalizeRequiredIsoDate,
  normalizeSecurityKey,
  normalizeStrategyId,
} = require("./signal_query_params");

class ExplainStrategySignalUseCase {
  constructor({ signalReader } = {}) {
    this.signalReader = assertSignalDetailReader(signalReader);
  }

  async execute({ strategyId, date, securityKey } = {}) {
    const normalizedStrategyId = normalizeStrategyId(strategyId);
    const normalizedDate = normalizeRequiredIsoDate(date);
    const normalizedSecurityKey = normalizeSecurityKey(securityKey);
    const result = await this.signalReader.getStrategySignal({
      strategyId: normalizedStrategyId,
      date: normalizedDate,
      securityKey: normalizedSecurityKey,
    });

    return {
      status: result.status,
      strategyId: result.strategyId,
      date: result.date,
      securityKey: result.securityKey,
      build: result.build,
      candidate: result.candidate
        ? projectSignalCandidate(result.candidate, { includeEvidence: true })
        : null,
      meta: {
        source: result.source,
      },
    };
  }
}

module.exports = {
  ExplainStrategySignalUseCase,
};
