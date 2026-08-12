"use strict";

const { assertSignalReader } = require("../../ports/strategy/signal_reader");
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

function projectCandidate(candidate, { includeEvidence }) {
  const item = {
    rank: Number.isInteger(candidate?.rank) ? candidate.rank : null,
    securityKey: String(candidate?.securityKey ?? ""),
    code: String(candidate?.code ?? ""),
    market: Number.isInteger(candidate?.market) ? candidate.market : Number(candidate?.market),
    rankingValues: Array.isArray(candidate?.rankingValues)
      ? candidate.rankingValues.map((value) => Number.isFinite(value) ? value : null)
      : [],
    qualityIssues: [...new Set((candidate?.qualityIssues ?? []).filter(Boolean))].sort(),
  };
  if (includeEvidence) {
    item.evidence = candidate?.evidence && typeof candidate.evidence === "object"
      ? candidate.evidence
      : {};
  }
  return item;
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
      candidates: (result.candidates ?? []).map((candidate) => projectCandidate(candidate, { includeEvidence })),
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
  projectCandidate,
};
