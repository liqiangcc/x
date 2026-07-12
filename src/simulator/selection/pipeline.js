"use strict";

const crypto = require("node:crypto");
const { stableStringify } = require("../data/data_manifest");
const { evaluateYearDeclineCloseBreakout } = require("../../signals/signals/year_decline_close_breakout");

const DEFAULT_PAGE_SIZE = 20;

function digest(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function yearBar(bar) {
  return { ...bar, year: Number(bar.date.slice(0, 4)) };
}

function signalContext({ asOfDate, dailyHistory, yearlyHistory }) {
  const isoDate = String(asOfDate).replace(
    /^(\d{4})(\d{2})(\d{2})$/,
    "$1-$2-$3",
  );
  const dailyRows = dailyHistory.bars.filter((bar) => bar.date <= isoDate);
  const yearlyRows = yearlyHistory.bars
    .filter((bar) => bar.date <= isoDate && Number(bar.date.slice(0, 4)) < Number(isoDate.slice(0, 4)))
    .map(yearBar);
  return {
    dailyRows,
    features: {
      completedYears: yearlyRows,
      today: dailyRows.find((bar) => bar.date === isoDate) ?? null,
    },
    isoDate,
  };
}

function compareCandidate(left, right) {
  const marginDiff = left.evidence.breakout_margin_pct - right.evidence.breakout_margin_pct;
  if (marginDiff !== 0) return marginDiff;
  return left.securityKey.localeCompare(right.securityKey);
}

function paginate(candidates, { page = 1, pageSize = DEFAULT_PAGE_SIZE, viewAll = false } = {}) {
  if (!Number.isInteger(page) || page < 1) throw new TypeError("page must be a positive integer.");
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new TypeError("pageSize must be a positive integer.");
  const items = viewAll ? candidates : candidates.slice((page - 1) * pageSize, page * pageSize);
  return {
    items,
    page: viewAll ? 1 : page,
    pageSize: viewAll ? candidates.length : pageSize,
    total: candidates.length,
    totalPages: viewAll ? (candidates.length > 0 ? 1 : 0) : Math.ceil(candidates.length / pageSize),
    viewAll,
  };
}

class CandidateSelectionPipeline {
  constructor({ historicalUniverse, klineRepository, cache = new Map() }) {
    if (!historicalUniverse || typeof historicalUniverse.list !== "function") {
      throw new TypeError("CandidateSelectionPipeline requires HistoricalUniverse.");
    }
    if (!klineRepository || typeof klineRepository.getLegacyHistory !== "function") {
      throw new TypeError("CandidateSelectionPipeline requires a kline repository.");
    }
    this.historicalUniverse = historicalUniverse;
    this.klineRepository = klineRepository;
    this.cache = cache;
  }

  async select({ asOfDate, config = {}, dataVersion = "legacy-current", ...pagination }) {
    const universe = await this.historicalUniverse.list({
      asOfDate,
      excludeSpecialTreatment: config.excludeSpecialTreatment !== false,
    });
    const configHash = digest(config);
    const cacheKey = digest({ asOfDate, configHash, dataVersion, universeSource: universe.source });
    let snapshot = this.cache.get(cacheKey);

    if (!snapshot) {
      const candidates = [];
      const qualityIssues = new Set(universe.qualityIssues);
      for (const security of universe.securities) {
        const [dailyHistory, yearlyHistory] = await Promise.all([
          this.klineRepository.getLegacyHistory({ ...security, endDate: asOfDate, period: "daily" }),
          this.klineRepository.getLegacyHistory({ ...security, endDate: asOfDate, period: "yearly" }),
        ]);
        dailyHistory.qualityIssues.forEach((issue) => qualityIssues.add(issue));
        yearlyHistory.qualityIssues.forEach((issue) => qualityIssues.add(issue));
        const result = evaluateYearDeclineCloseBreakout(signalContext({ asOfDate, dailyHistory, yearlyHistory }));
        result.qualityIssues.forEach((issue) => qualityIssues.add(issue));
        if (!result.ok) continue;
        candidates.push({
          evidence: result.evidence,
          market: security.market,
          code: security.code,
          securityKey: `${security.market}.${security.code}`,
        });
      }
      candidates.sort(compareCandidate);
      snapshot = Object.freeze({
        asOfDate,
        cacheKey,
        candidates: Object.freeze(candidates),
        configHash,
        dataVersion,
        excludedCount: universe.excluded.length,
        qualityIssues: Object.freeze([...qualityIssues].sort()),
        universeSource: universe.source,
      });
      this.cache.set(cacheKey, snapshot);
    }

    return {
      ...snapshot,
      candidates: undefined,
      pagination: paginate(snapshot.candidates, pagination),
    };
  }
}

module.exports = {
  CandidateSelectionPipeline,
  DEFAULT_PAGE_SIZE,
  compareCandidate,
  digest,
  paginate,
  signalContext,
};
