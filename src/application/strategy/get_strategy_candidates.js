"use strict";

const { assertSignalReader } = require("../../ports/strategy/signal_reader");
const { projectSignalCandidate } = require("./signal_candidate_projection");
const {
  normalizeOptionalIsoDate,
  normalizeStrategyId,
} = require("./signal_query_params");

function normalizeLimit(value) {
  const normalized = value ?? 50;
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 200) {
    throw new TypeError("limit must be an integer between 1 and 200.");
  }
  return normalized;
}

function normalizeOffset(value) {
  const normalized = value ?? 0;
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw new TypeError("offset must be a non-negative integer.");
  }
  return normalized;
}

class GetStrategyCandidatesUseCase {
  constructor({ signalReader } = {}) {
    this.signalReader = assertSignalReader(signalReader);
  }

  async execute({
    strategyId,
    date = null,
    limit = 50,
    offset = 0,
    includeEvidence = false,
  } = {}) {
    if (typeof includeEvidence !== "boolean") {
      throw new TypeError("includeEvidence must be a boolean.");
    }
    const normalizedStrategyId = normalizeStrategyId(strategyId);
    const normalizedDate = normalizeOptionalIsoDate(date);
    const normalizedLimit = normalizeLimit(limit);
    const normalizedOffset = normalizeOffset(offset);
    const result = await this.signalReader.getStrategyCandidates({
      strategyId: normalizedStrategyId,
      date: normalizedDate,
      limit: normalizedLimit,
      offset: normalizedOffset,
    });

    return {
      status: result.status,
      strategyId: result.strategyId,
      date: result.date,
      build: result.build,
      candidates: (result.candidates ?? []).map((candidate) => projectSignalCandidate(candidate, { includeEvidence })),
      page: result.page,
      meta: {
        source: result.source,
      },
    };
  }
}

module.exports = {
  GetStrategyCandidatesUseCase,
  normalizeLimit,
  normalizeOffset,
  normalizeOptionalIsoDate,
  normalizeStrategyId,
  projectCandidate: projectSignalCandidate,
};
