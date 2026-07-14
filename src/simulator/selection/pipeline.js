"use strict";

const crypto = require("node:crypto");
const { stableStringify } = require("../data/data_manifest");
const { hasEligibleYear } = require("../../strategies/year_decline");
const { compileStrategy } = require("../../strategies/strategy_builder");
const { marketBoardAllowed } = require("../../core/market_board");

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_SCAN_CONCURRENCY = 16;

function digest(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function yearBar(bar) {
  return { ...bar, year: Number(bar.date.slice(0, 4)) };
}

function signalContext({ asOfDate, dailyHistory, security = null, yearlyHistory }) {
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
      currentYearBeforeToday: dailyRows.filter((bar) => bar.date.startsWith(`${isoDate.slice(0, 4)}-`) && bar.date < isoDate),
      today: dailyRows.find((bar) => bar.date === isoDate) ?? null,
    },
    isoDate,
    security,
  };
}

function compareCandidate(left, right) {
  const leftMargin = Number.isFinite(left.evidence.breakout_margin_pct) ? left.evidence.breakout_margin_pct : Number.POSITIVE_INFINITY;
  const rightMargin = Number.isFinite(right.evidence.breakout_margin_pct) ? right.evidence.breakout_margin_pct : Number.POSITIVE_INFINITY;
  const marginDiff = leftMargin - rightMargin;
  if (marginDiff !== 0) return marginDiff;
  return left.securityKey.localeCompare(right.securityKey);
}

function candidateComparator(compiled) {
  return typeof compiled?.compareCandidates === "function"
    ? compiled.compareCandidates
    : compareCandidate;
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

function applyMarketScope(universe, config = {}) {
  return {
    ...universe,
    securities: universe.securities.filter((security) => marketBoardAllowed(security, config.universe)),
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
    const universe = applyMarketScope(await this.historicalUniverse.list({
      asOfDate: endDate,
      excludeSpecialTreatment: config.excludeSpecialTreatment !== false,
    }), config);
    const qualityIssues = new Set(universe.qualityIssues);
    const concurrency = Math.max(1, Number(process.env.SIMULATOR_SCAN_CONCURRENCY ?? DEFAULT_SCAN_CONCURRENCY));
    const yearlyRows = await mapConcurrent(universe.securities, concurrency, async (security) => {
      const history = await this.klineRepository.getLegacyHistory({ ...security, endDate, period: "yearly" });
      history.qualityIssues.forEach((issue) => qualityIssues.add(issue));
      return { history, security };
    });
    const compiled = compileStrategy(config.strategy);
    const shortlisted = yearlyRows.filter(({ history }) => !compiled.hasYearlyPrefilter || targetYears.some((targetYear) => compiled.yearlyPrefilter(
      history.bars.filter((bar) => Number(bar.date.slice(0, 4)) < targetYear).map(yearBar),
    )));
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
        const result = compiled.evaluate({
          dailyRows,
          features: {
            completedYears: completedYears.filter((point) => point.year < year),
            today: bar,
          },
          isoDate: bar.date,
          security,
        });
        result.qualityIssues.forEach((issue) => qualityIssues.add(issue));
        if (result.ok) candidatesByDate.get(bar.date).push({
          code: security.code,
          evidence: result.evidence,
          market: security.market,
          rankingValues: result.rankingValues,
          securityKey: `${security.market}.${security.code}`,
        });
      }
    });

    const issues = Object.freeze([...qualityIssues].sort());
    for (const asOfDate of normalizedDates) {
      const candidates = candidatesByDate.get(asOfDate);
      candidates.sort(candidateComparator(compiled));
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

  async buildAll({ config = {}, dataVersion = "legacy-current", endDate = "9999-12-31", onProgress = () => {}, securityCodes = null }) {
    const compiled = compileStrategy(config.strategy);
    const fullUniverse = applyMarketScope(await this.historicalUniverse.list({
      asOfDate: endDate,
      excludeSpecialTreatment: config.excludeSpecialTreatment !== false,
    }), config);
    const requestedCodes = Array.isArray(securityCodes) ? new Set(securityCodes.map(String)) : null;
    const universe = requestedCodes
      ? { ...fullUniverse, securities: fullUniverse.securities.filter((security) => requestedCodes.has(String(security.code))) }
      : fullUniverse;
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
    const shortlisted = yearlyRows.filter(({ history }) => !compiled.hasYearlyPrefilter || history.bars.some((bar) => {
      const targetYear = Number(bar.date.slice(0, 4)) + 1;
      return compiled.yearlyPrefilter(history.bars.filter((point) => Number(point.date.slice(0, 4)) < targetYear).map(yearBar));
    }));
    const byDate = new Map();
    let dailyCompleted = 0;
    onProgress({ completed: 0, phase: "daily_scan", total: shortlisted.length });
    await mapConcurrent(shortlisted, concurrency, async ({ history: yearlyHistory, security }) => {
      const dailyHistory = await this.klineRepository.getLegacyHistory({ ...security, endDate, period: "daily" });
      dailyHistory.qualityIssues.forEach((issue) => qualityIssues.add(issue));
      const completedYears = yearlyHistory.bars.map(yearBar);
      const accumulatedDaily = [];
      const evaluationState = compiled.createEvaluationState?.() ?? null;
      let currentDailyYear = null;
      let currentYearBeforeToday = [];
      for (const bar of dailyHistory.bars) {
        const year = Number(bar.date.slice(0, 4));
        if (currentDailyYear !== year) {
          currentDailyYear = year;
          currentYearBeforeToday = [];
        }
        accumulatedDaily.push(bar);
        const applicableYears = completedYears.filter((point) => point.year < year);
        if (compiled.yearlyPrefilter(applicableYears)) {
          const result = compiled.evaluate({
            dailyRows: accumulatedDaily,
            features: { completedYears: applicableYears, currentYearBeforeToday, today: bar },
            isoDate: bar.date,
            security,
          }, evaluationState);
          result.qualityIssues.forEach((issue) => qualityIssues.add(issue));
          if (result.ok) {
            const candidate = {
              code: security.code,
              evidence: result.evidence,
              market: security.market,
              rankingValues: result.rankingValues,
              securityKey: `${security.market}.${security.code}`,
            };
            if (!byDate.has(bar.date)) byDate.set(bar.date, []);
            byDate.get(bar.date).push(candidate);
          }
        }
        currentYearBeforeToday.push(bar);
      }
      dailyCompleted += 1;
      if (dailyCompleted % 25 === 0 || dailyCompleted === shortlisted.length) {
        onProgress({ completed: dailyCompleted, phase: "daily_scan", total: shortlisted.length });
      }
    });
    for (const candidates of byDate.values()) candidates.sort(candidateComparator(compiled));
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
    const universe = applyMarketScope(await this.historicalUniverse.list({
      asOfDate,
      excludeSpecialTreatment: config.excludeSpecialTreatment !== false,
    }), config);
    const cacheKey = digest({ asOfDate, configHash, dataVersion, universeSource: universe.source });
    let snapshot = this.cache.get(cacheKey);

    if (!snapshot) {
      const compiled = compileStrategy(config.strategy);
      const candidates = [];
      const qualityIssues = new Set(universe.qualityIssues);
      for (const security of universe.securities) {
        const [dailyHistory, yearlyHistory] = await Promise.all([
          this.klineRepository.getLegacyHistory({ ...security, endDate: asOfDate, period: "daily" }),
          this.klineRepository.getLegacyHistory({ ...security, endDate: asOfDate, period: "yearly" }),
        ]);
        dailyHistory.qualityIssues.forEach((issue) => qualityIssues.add(issue));
        yearlyHistory.qualityIssues.forEach((issue) => qualityIssues.add(issue));
        const result = compiled.evaluate(signalContext({ asOfDate, dailyHistory, security, yearlyHistory }));
        result.qualityIssues.forEach((issue) => qualityIssues.add(issue));
        if (!result.ok) continue;
        candidates.push({
          evidence: result.evidence,
          market: security.market,
          code: security.code,
          rankingValues: result.rankingValues,
          securityKey: `${security.market}.${security.code}`,
        });
      }
      candidates.sort(candidateComparator(compiled));
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
  applyMarketScope,
  DEFAULT_SCAN_CONCURRENCY,
  DEFAULT_PAGE_SIZE,
  compareCandidate,
  candidateComparator,
  digest,
  hasEligibleYear,
  mapConcurrent,
  paginate,
  signalContext,
};
