"use strict";

const crypto = require("node:crypto");
const { stableStringify } = require("../data/data_manifest");
const { evaluateYearDeclineCloseBreakout } = require("../../signals/signals/year_decline_close_breakout");

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_SCAN_CONCURRENCY = 16;

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

async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

function hasEligibleYear(yearlyBars, targetYears, downTransitions = 3) {
  const byYear = new Map(yearlyBars.map((bar) => [Number(bar.date.slice(0, 4)), bar]));
  return targetYears.some((year) => {
    const requiredYears = downTransitions + 1;
    const points = Array.from({ length: requiredYears }, (_item, index) => byYear.get(year - requiredYears + index));
    return points.every((point) => Number.isFinite(point?.close) && Number.isFinite(point?.high))
      && points.slice(1).every((point, index) => point.close < points[index].close);
  });
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
    this.prepared = new Map();
  }

  async prepare({ dates, config = {}, dataVersion = "legacy-current" }) {
    const normalizedDates = [...new Set(dates)].sort();
    if (normalizedDates.length === 0) return;
    const configHash = digest(config);
    const missingDates = normalizedDates.filter((asOfDate) => !this.prepared.has(digest({ asOfDate, configHash, dataVersion })));
    if (missingDates.length === 0) return;

    const endDate = normalizedDates.at(-1);
    const targetYears = [...new Set(normalizedDates.map((date) => Number(date.slice(0, 4))))];
    const targetSet = new Set(normalizedDates);
    const universe = await this.historicalUniverse.list({
      asOfDate: endDate,
      excludeSpecialTreatment: config.excludeSpecialTreatment !== false,
    });
    const qualityIssues = new Set(universe.qualityIssues);
    const concurrency = Math.max(1, Number(process.env.SIMULATOR_SCAN_CONCURRENCY ?? DEFAULT_SCAN_CONCURRENCY));
    const yearlyRows = await mapConcurrent(universe.securities, concurrency, async (security) => {
      const history = await this.klineRepository.getLegacyHistory({ ...security, endDate, period: "yearly" });
      history.qualityIssues.forEach((issue) => qualityIssues.add(issue));
      return { history, security };
    });
    const downTransitions = config.strategy?.downTransitions ?? 3;
    const shortlisted = yearlyRows.filter(({ history }) => hasEligibleYear(history.bars, targetYears, downTransitions));
    const candidatesByDate = new Map(normalizedDates.map((date) => [date, []]));

    await mapConcurrent(shortlisted, concurrency, async ({ history: yearlyHistory, security }) => {
      const dailyHistory = await this.klineRepository.getLegacyHistory({ ...security, endDate, period: "daily" });
      dailyHistory.qualityIssues.forEach((issue) => qualityIssues.add(issue));
      const completedYears = yearlyHistory.bars.map(yearBar);
      const dailyRows = [];
      for (const bar of dailyHistory.bars) {
        dailyRows.push(bar);
        if (!targetSet.has(bar.date)) continue;
        const year = Number(bar.date.slice(0, 4));
        const result = evaluateYearDeclineCloseBreakout({
          dailyRows,
          features: {
            completedYears: completedYears.filter((point) => point.year < year),
            today: bar,
          },
          isoDate: bar.date,
        }, config.strategy);
        result.qualityIssues.forEach((issue) => qualityIssues.add(issue));
        if (result.ok) candidatesByDate.get(bar.date).push({
          code: security.code,
          evidence: result.evidence,
          market: security.market,
          securityKey: `${security.market}.${security.code}`,
        });
      }
    });

    const issues = Object.freeze([...qualityIssues].sort());
    for (const asOfDate of normalizedDates) {
      const candidates = candidatesByDate.get(asOfDate);
      candidates.sort(compareCandidate);
      this.prepared.set(digest({ asOfDate, configHash, dataVersion }), Object.freeze({
        asOfDate,
        candidates: Object.freeze(candidates),
        configHash,
        dataVersion,
        excludedCount: universe.excluded.length,
        qualityIssues: issues,
        universeSource: universe.source,
      }));
    }
  }

  async buildAll({ config = {}, dataVersion = "legacy-current", endDate = "9999-12-31", onProgress = () => {} }) {
    const strategyConfig = config.strategy ?? {};
    const downTransitions = strategyConfig.downTransitions ?? 3;
    const requiredYears = downTransitions + 1;
    const universe = await this.historicalUniverse.list({
      asOfDate: endDate,
      excludeSpecialTreatment: config.excludeSpecialTreatment !== false,
    });
    const qualityIssues = new Set(universe.qualityIssues);
    const concurrency = Math.max(1, Number(process.env.SIMULATOR_SCAN_CONCURRENCY ?? DEFAULT_SCAN_CONCURRENCY));
    onProgress({ completed: 0, phase: "yearly_prefilter", total: universe.securities.length });
    let yearlyCompleted = 0;
    const yearlyRows = await mapConcurrent(universe.securities, concurrency, async (security) => {
      const history = await this.klineRepository.getLegacyHistory({ ...security, endDate, period: "yearly" });
      history.qualityIssues.forEach((issue) => qualityIssues.add(issue));
      yearlyCompleted += 1;
      if (yearlyCompleted % 100 === 0 || yearlyCompleted === universe.securities.length) {
        onProgress({ completed: yearlyCompleted, phase: "yearly_prefilter", total: universe.securities.length });
      }
      return { history, security };
    });
    const shortlisted = yearlyRows.filter(({ history }) => {
      const years = history.bars.map((bar) => Number(bar.date.slice(0, 4)) + 1);
      return hasEligibleYear(history.bars, years, downTransitions);
    });
    const byDate = new Map();
    let dailyCompleted = 0;
    onProgress({ completed: 0, phase: "daily_scan", total: shortlisted.length });
    await mapConcurrent(shortlisted, concurrency, async ({ history: yearlyHistory, security }) => {
      const dailyHistory = await this.klineRepository.getLegacyHistory({ ...security, endDate, period: "daily" });
      dailyHistory.qualityIssues.forEach((issue) => qualityIssues.add(issue));
      const byYear = new Map(yearlyHistory.bars.map((bar) => [Number(bar.date.slice(0, 4)), yearBar(bar)]));
      const maxCloseByYear = new Map();
      for (const [index, bar] of dailyHistory.bars.entries()) {
        const year = Number(bar.date.slice(0, 4));
        const points = Array.from({ length: requiredYears }, (_item, index) => byYear.get(year - requiredYears + index));
        const previousHigh = points.at(-1)?.high;
        const previousMax = maxCloseByYear.get(year) ?? null;
        const consecutiveDecline = points.every((point) => Number.isFinite(point?.close) && Number.isFinite(point?.high))
          && points.slice(1).every((point, index) => point.close < points[index].close);
        if (consecutiveDecline && Number.isFinite(bar.close) && Number.isFinite(previousHigh)
          && (previousMax === null || previousMax <= previousHigh) && bar.close > previousHigh) {
          const candidate = {
            code: security.code,
            evidence: {
              annual_points: points.map((point) => ({ close: point.close, high: point.high, year: point.year })),
              breakout_margin: bar.close - previousHigh,
              breakout_margin_pct: ((bar.close - previousHigh) / previousHigh) * 100,
              max_previous_current_year_close: previousMax,
              previous_year_high: previousHigh,
              down_transitions: downTransitions,
              required_complete_years: requiredYears,
              rule_summary: `${requiredYears}个完整年度收盘逐年降低，当前年度首次收盘突破去年最高价`,
              today_close: bar.close,
              today_date: bar.date,
            },
            market: security.market,
            securityKey: `${security.market}.${security.code}`,
          };
          if (!byDate.has(bar.date)) byDate.set(bar.date, []);
          byDate.get(bar.date).push(candidate);
        }
        if (Number.isFinite(bar.close)) maxCloseByYear.set(year, Math.max(previousMax ?? -Infinity, bar.close));
      }
      dailyCompleted += 1;
      if (dailyCompleted % 25 === 0 || dailyCompleted === shortlisted.length) {
        onProgress({ completed: dailyCompleted, phase: "daily_scan", total: shortlisted.length });
      }
    });
    for (const candidates of byDate.values()) candidates.sort(compareCandidate);
    return {
      byDate,
      configHash: digest(config),
      dataVersion,
      qualityIssues: [...qualityIssues].sort(),
      securityCount: shortlisted.length,
      signalCount: [...byDate.values()].reduce((sum, items) => sum + items.length, 0),
    };
  }

  async select({ asOfDate, config = {}, dataVersion = "legacy-current", ...pagination }) {
    const configHash = digest(config);
    const prepared = this.prepared.get(digest({ asOfDate, configHash, dataVersion }));
    if (prepared) {
      return { ...prepared, candidates: undefined, pagination: paginate(prepared.candidates, pagination) };
    }
    const universe = await this.historicalUniverse.list({
      asOfDate,
      excludeSpecialTreatment: config.excludeSpecialTreatment !== false,
    });
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
        const result = evaluateYearDeclineCloseBreakout(signalContext({ asOfDate, dailyHistory, yearlyHistory }), config.strategy);
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
  DEFAULT_SCAN_CONCURRENCY,
  DEFAULT_PAGE_SIZE,
  compareCandidate,
  digest,
  hasEligibleYear,
  mapConcurrent,
  paginate,
  signalContext,
};
