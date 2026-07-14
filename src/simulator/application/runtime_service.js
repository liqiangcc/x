"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { randomInt, randomUUID } = require("node:crypto");
const { Account } = require("../core/account");
const { Position } = require("../core/position");
const { Order } = require("../core/order");
const { SimulatorSession } = require("../core/session");
const { SessionMode } = require("../core/enums");
const { ExistingKlineRepository } = require("../adapters/ledger/existing_kline_repository");
const { LegacyTradingCalendar } = require("../data/legacy_trading_calendar");
const { ExistingUniverseRepository } = require("../adapters/ledger/existing_universe");
const { SecurityIdentityDirectory } = require("../adapters/ledger/security_identity_directory");
const { HistoricalUniverse } = require("../selection/historical_universe");
const { CandidateSelectionPipeline, compareCandidate, paginate } = require("../selection/pipeline");
const { CandidateAliasRegistry } = require("../selection/aliases");
const { candidateDto, chartDto, holdingDto } = require("../selection/candidate_dto");
const { calculateBollSeries } = require("../../signals/indicators/boll");
const { OrderApplicationService } = require("./orders");
const { TradingSessionEngine } = require("./sessions");
const { digest } = require("../selection/pipeline");
const { buildSessionReport, identityRows, reconstructStockCycles } = require("./reports");
const { accountDto, sessionDto } = require("../adapters/http/dto");
const { DataStatusService } = require("../../kline/data_status");
const { ProxyQualityService } = require("./proxy_quality_service");
const { StrategySyncOrchestrator } = require("./strategy_sync_orchestrator");
const { calculateFees, cents } = require("../mechanisms/fee_model");
const { OrderSide, OrderStatus } = require("../core/enums");
const { DEFAULT_STRATEGY_MARKET_BOARDS, normalizeMarketBoards } = require("../../core/market_board");
const { STRATEGY_BUILDER_CATALOG, compileStrategy, defaultCompositeStrategy, toV3Definition } = require("../../strategies/strategy_builder");

const DEFAULT_STRATEGY_ID = "system-three-year-decline-breakout-v2";

function strategyAlgorithmVersion(strategy) {
  return compileStrategy(strategy?.config?.strategy).engineVersion;
}

function signalIdentity(index) {
  return JSON.stringify([...index.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, candidates]) => [
    date,
    candidates.map((candidate) => candidate.securityKey).sort(),
  ]));
}

function httpError(code, message, statusCode = 422, issues = []) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  error.issues = issues;
  return error;
}

function orderDto(order) {
  return {
    candidateId: order.candidateId,
    estimatedFees: order.estimatedFees,
    estimatedPrice: order.estimatedPrice,
    id: order.id,
    quantity: order.quantity,
    reason: order.reason,
    rejectionReason: order.rejectionReason,
    referencePrice: order.referencePrice,
    reservationLimitRate: order.reservationLimitRate,
    reservedAmount: order.reservedAmount,
    side: order.side,
    status: order.status,
    tradingDate: order.tradingDate,
    type: order.type,
  };
}

function reservationLimitRate({ code }) {
  if (/^(4|8|92)/.test(code)) return 0.30;
  if (/^(300|301|688|689)/.test(code)) return 0.20;
  if (/^\d{6}$/.test(code)) return 0.10;
  return 0.30;
}

function securityFromCode(code) {
  return { code: String(code), market: /^6/.test(String(code)) ? 1 : 0 };
}

function positionCycleOpenDates({ fills = [], orders = new Map() } = {}) {
  const orderMap = orders instanceof Map ? orders : new Map(orders.map((order) => [order.id, order]));
  const balances = new Map();
  const openedAt = new Map();
  for (const fill of fills) {
    const order = orderMap.get(fill.orderId);
    if (!order?.security) continue;
    const key = `${order.security.market}.${order.security.code}`;
    const current = balances.get(key) ?? 0;
    if (fill.side === OrderSide.BUY) {
      if (current === 0) openedAt.set(key, fill.date);
      balances.set(key, current + fill.quantity);
    } else if (fill.side === OrderSide.SELL) {
      const next = Math.max(0, current - fill.quantity);
      balances.set(key, next);
      if (next === 0) openedAt.delete(key);
    }
  }
  return openedAt;
}

function dailyChartWindow(bars, signalDate = null, visibleBars = 20) {
  const source = bars.slice(-(visibleBars + 19));
  const boll = calculateBollSeries(source);
  return source.map((bar, index) => ({
    ...bar,
    bollLower: boll[index].lower,
    bollMiddle: boll[index].middle,
    bollUpper: boll[index].upper,
    signal: bar.date === signalDate,
  })).slice(-visibleBars);
}

function yearlyChartWindow(yearlyBars, dailyBars, endDate) {
  const currentYear = Number(String(endDate).slice(0, 4));
  const completed = yearlyBars
    .map((bar) => ({ ...bar, year: Number(bar.date.slice(0, 4)) }))
    .filter((bar) => bar.year !== currentYear);
  const currentRows = dailyBars.filter((bar) => Number(bar.date.slice(0, 4)) === currentYear);
  if (currentRows.length === 0) {
    const storedCurrent = yearlyBars.find((bar) => Number(bar.date.slice(0, 4)) === currentYear);
    return storedCurrent ? [...completed, { ...storedCurrent, year: currentYear }] : completed;
  }
  return [...completed, {
    amount: currentRows.reduce((sum, bar) => sum + bar.amount, 0),
    close: currentRows.at(-1).close,
    high: Math.max(...currentRows.map((bar) => bar.high)),
    low: Math.min(...currentRows.map((bar) => bar.low)),
    open: currentRows[0].open,
    volume: currentRows.reduce((sum, bar) => sum + bar.volume, 0),
    year: currentYear,
  }];
}

function justCrossedBollMiddle(previous, latest) {
  if (!Number.isFinite(previous?.bollMiddle) || !Number.isFinite(latest?.bollMiddle)) return null;
  return previous.close <= previous.bollMiddle && latest.close > latest.bollMiddle;
}

function prioritizeHeldWatchlist(items) {
  return items
    .map((item, index) => ({ index, item }))
    .sort((left, right) => {
      const leftReturn = left.item.detail?.holding?.unrealizedPnlPct;
      const rightReturn = right.item.detail?.holding?.unrealizedPnlPct;
      const leftRanked = Number.isFinite(leftReturn);
      const rightRanked = Number.isFinite(rightReturn);
      return Number(rightRanked) - Number(leftRanked)
        || (leftRanked && rightRanked ? rightReturn - leftReturn : 0)
        || left.index - right.index;
    })
    .map(({ item }) => item);
}

function mergeStrategySignals(currentByDate, changedByDate, changedCodes) {
  const codes = new Set((changedCodes ?? []).map(String));
  const merged = new Map();
  for (const [date, candidates] of currentByDate ?? []) {
    const retained = candidates.filter((candidate) => !codes.has(String(candidate.code)));
    if (retained.length > 0) merged.set(date, [...retained]);
  }
  for (const [date, candidates] of changedByDate ?? []) {
    const combined = [...(merged.get(date) ?? []), ...candidates];
    combined.sort(compareCandidate);
    if (combined.length > 0) merged.set(date, combined);
  }
  return merged;
}

function buyReservationInput(entry, input) {
  if (input.side !== OrderSide.BUY) return input;
  const candidate = entry.session.candidateSnapshot.candidates.find((item) => item.candidateId === input.candidateId);
  if (!candidate && !entry.watchlist?.has(input.candidateId)) {
    throw httpError("buy_requires_current_candidate", "Buy orders require a current candidate or watchlist security.", 422);
  }
  const security = entry.aliases.resolve(input.candidateId);
  const referencePrice = Number(candidate?.evidence?.today_close ?? input.serverReferencePrice);
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
    throw httpError("missing_reference_price", "The current candidate has no valid reference price.", 422);
  }
  const limitRate = reservationLimitRate(security);
  const estimatedPrice = cents(referencePrice * (1 + limitRate));
  const estimatedFees = calculateFees({
    ...(entry.config.execution ?? {}),
    grossAmount: estimatedPrice * input.quantity,
    side: input.side,
  }).total;
  return { ...input, estimatedFees, estimatedPrice, referencePrice, reservationLimitRate: limitRate };
}

class SimulatorRuntimeService {
  constructor({
    dataStatusService = new DataStatusService(),
    proxyQualityService = new ProxyQualityService(),
    klineRepository = new ExistingKlineRepository({ cacheSize: Number(process.env.SIMULATOR_KLINE_CACHE_SIZE ?? 64) }),
    identityDirectory = new SecurityIdentityDirectory(),
    onPerformance = null,
    repository = null,
    selectionPipeline = null,
    strategySyncOrchestrator = new StrategySyncOrchestrator(),
    universeRepository = new ExistingUniverseRepository(),
  } = {}) {
    this.dataStatusService = dataStatusService;
    this.proxyQualityService = proxyQualityService;
    this.klineRepository = klineRepository;
    this.identityDirectory = identityDirectory;
    this.onPerformance = typeof onPerformance === "function" ? onPerformance : null;
    this.repository = repository;
    this.selectionPipeline = selectionPipeline ?? new CandidateSelectionPipeline({
      historicalUniverse: new HistoricalUniverse({ repository: universeRepository }),
      klineRepository,
    });
    this.strategySyncOrchestrator = strategySyncOrchestrator;
    this.entries = new Map();
    this.accountProfiles = new Map();
    this.strategies = new Map();
    this.strategyTemplates = new Map();
    this.strategyBuilds = new Map();
    this.strategyIndexes = new Map();
    this.strategyBuildQueue = Promise.resolve();
    const systemTemplates = STRATEGY_BUILDER_CATALOG.templates.map((template) => ({
      definition: JSON.parse(JSON.stringify(template.defaultDefinition)),
      description: template.description,
      id: template.id,
      isSystem: true,
      name: template.label,
      version: 1,
    }));
    for (const template of (this.repository?.listStrategyTemplates?.() ?? systemTemplates)) this.strategyTemplates.set(template.id, template);
    for (const template of systemTemplates) {
      const existing = this.strategyTemplates.get(template.id);
      if (existing?.definition?.schemaVersion === 3) continue;
      const next = existing ? { ...template, currentRevision: (existing.currentRevision ?? existing.version) + 1, version: existing.version + 1 } : { ...template, currentRevision: 1 };
      this.strategyTemplates.set(template.id, next);
      this.repository?.saveStrategyTemplate?.(next);
      this.repository?.saveStrategyTemplateRevision?.(next);
    }
    const legacyDefaultStrategy = {
      activeRevision: 1,
      config: { excludeSpecialTreatment: true, limit: 20, orderBy: "breakout_margin_ascending", strategy: { type: "year_decline_close_breakout" }, universe: { ...DEFAULT_STRATEGY_MARKET_BOARDS } },
      id: "system-year-decline-breakout",
      isSystem: true,
      name: "旧版兼容：连续下跌后首次突破",
      status: "building",
      version: 1,
    };
    const defaultStrategy = {
      activeRevision: 1,
      config: { excludeSpecialTreatment: true, limit: 20, orderBy: "price_ascending", strategy: toV3Definition(defaultCompositeStrategy()), universe: { ...DEFAULT_STRATEGY_MARKET_BOARDS } },
      id: DEFAULT_STRATEGY_ID,
      isSystem: true,
      name: "连续下跌3年后首次突破",
      status: "building",
      version: 1,
    };
    const systemStrategies = [defaultStrategy, legacyDefaultStrategy];
    const storedStrategies = this.repository?.listStrategies?.() ?? [];
    for (const strategy of storedStrategies) this.strategies.set(strategy.id, strategy);
    for (const systemStrategy of systemStrategies) {
      if (this.strategies.has(systemStrategy.id)) continue;
      this.strategies.set(systemStrategy.id, systemStrategy);
      this.repository?.saveStrategy?.(systemStrategy);
      this.repository?.saveStrategyRevision?.({
        config: systemStrategy.config,
        revision: 1,
        schemaVersion: systemStrategy.config.strategy?.schemaVersion ?? 1,
        status: systemStrategy.status,
        strategyId: systemStrategy.id,
      });
    }
    for (const strategy of this.strategies.values()) {
      if (strategy.archived) continue;
      if (strategy.isSystem && !strategy.config?.universe) {
        strategy.config = { ...strategy.config, universe: { ...DEFAULT_STRATEGY_MARKET_BOARDS } };
        this.repository?.saveStrategy(strategy);
      }
      if (strategy.isSystem && Object.hasOwn(strategy.config?.strategy ?? {}, "requireBollMiddleCross")) {
        const { requireBollMiddleCross, ...rule } = strategy.config.strategy;
        void requireBollMiddleCross;
        strategy.config = { ...strategy.config, strategy: rule };
        this.repository?.saveStrategy(strategy);
      }
      const build = this.repository?.latestStrategyBuild?.(strategy.id);
      if (build) this.strategyBuilds.set(strategy.id, build);
      const readyBuild = this.repository?.latestReadyStrategyBuild?.(strategy.id, strategyAlgorithmVersion(strategy))
        ?? (build?.status === "ready" && build.algorithmVersion === strategyAlgorithmVersion(strategy) ? build : null);
      if (strategy.status === "ready" && readyBuild) {
        this.strategyIndexes.set(strategy.id, this.repository.loadStrategySignals(readyBuild.id));
        if (strategy.config?.strategy?.schemaVersion !== 3) {
          const revision = (strategy.activeRevision ?? strategy.version) + 1;
          const candidateStrategy = {
            ...strategy,
            activeRevision: revision,
            config: { ...strategy.config, strategy: toV3Definition(strategy.config.strategy, { orderBy: strategy.config.orderBy }) },
            status: "building",
            version: strategy.version + 1,
          };
          this.repository.saveStrategyRevision?.({
            config: candidateStrategy.config,
            revision,
            schemaVersion: 3,
            status: "building",
            strategyId: strategy.id,
          });
          this.#enqueueStrategyBuild(strategy.id, { candidateStrategy, verifySignals: true });
        }
      } else if (this.repository) {
        strategy.status = "building";
        this.repository.saveStrategy(strategy);
        this.#enqueueStrategyBuild(strategy.id);
      }
    }
    for (const profile of this.repository?.listAccountProfiles?.() ?? []) {
      this.#restoreAccount(profile);
      const build = this.strategyBuilds.get(profile.strategyId);
      if (build?.algorithmVersion === strategyAlgorithmVersion(this.strategies.get(profile.strategyId))) {
        profile.calculatedDate = null;
        const entry = this.entries.get(profile.accountId);
        if (entry) entry.profile.calculatedDate = null;
        this.repository?.saveAccountProfile?.(profile);
      }
    }
  }

  #runtimeState(entry) {
    return {
      account: {
        cashAvailable: entry.account.cashAvailable,
        frozenCash: [...entry.account.frozenCash],
        initialCash: entry.account.initialCash,
        positions: [...entry.account.positions.values()].map((position) => ({
          averageCost: position.averageCost,
          frozen: [...position.frozen],
          quantity: position.quantity,
          realizedPnl: position.realizedPnl,
          security: position.security,
          unsettled: position.unsettled,
        })),
        realizedPnl: entry.account.realizedPnl,
        totalFees: entry.account.totalFees,
      },
      aliases: entry.aliases.records(),
      config: entry.config,
      dataVersion: entry.dataVersion,
      dates: entry.session.clock.dates,
      fills: entry.engine?.fills ?? [],
      orders: entry.orderService ? [...entry.orderService.orders.values()].map((order) => ({ ...order })) : [],
      profile: entry.profile,
      runtimeVersion: 1,
      session: entry.session.snapshot(),
      watchlist: [...(entry.watchlist ?? [])],
    };
  }

  #restoreAccount(profile) {
    const stored = this.repository.getSession(profile.accountId);
    const state = stored?.state;
    if (state?.runtimeVersion !== 1) return;
    const aliases = new CandidateAliasRegistry({ identityResolver: (security) => this.identityDirectory.lookup(security) })
      .restore(state.aliases ?? []);
    const candidateSnapshot = {
      ...state.session.candidateSnapshot,
      candidates: Object.freeze((state.session.candidateSnapshot?.candidates ?? []).map((candidate) => {
        const security = aliases.resolve(candidate.candidateId);
        return security ? { ...candidate, ...aliases.publicForSecurity(security) } : candidate;
      })),
    };
    const session = new SimulatorSession({
      candidateSnapshot,
      dates: state.dates,
      id: state.session.id,
      mode: state.session.mode,
      startDate: state.session.clock.currentDate,
    });
    session.version = state.session.version;
    session.status = state.session.status;
    session.revealedAt = state.session.revealedAt;
    const account = new Account({ initialCash: state.account.initialCash });
    account.cashAvailable = state.account.cashAvailable;
    account.frozenCash = new Map(state.account.frozenCash ?? []);
    account.realizedPnl = state.account.realizedPnl;
    account.totalFees = state.account.totalFees;
    for (const source of state.account.positions ?? []) {
      const position = new Position({ averageCost: source.averageCost, quantity: source.quantity, security: source.security });
      position.frozen = new Map(source.frozen ?? []);
      position.realizedPnl = source.realizedPnl;
      position.unsettled = source.unsettled ?? [];
      account.positions.set(`${source.security.market}.${source.security.code}`, position);
    }
    const orderService = new OrderApplicationService({ account, aliases, session });
    for (const source of state.orders ?? []) {
      const order = new Order(source);
      Object.assign(order, source);
      orderService.orders.set(order.id, order);
    }
    const entry = {
      account, accountHistory: [], aliases, config: state.config, dataVersion: state.dataVersion,
      orderService, profile: { ...profile }, session,
      watchlist: new Set((this.repository.listWatchlist?.(session.id) ?? []).map((item) => item.candidateId)),
    };
    entry.engine = new TradingSessionEngine({
      account,
      candidateSnapshotFactory: async (date) => Object.freeze({
        asOfDate: date, candidates: Object.freeze([]), configHash: digest(entry.config.selection),
        dataMode: "legacy_approximate", dataVersion: entry.dataVersion, qualityIssues: Object.freeze([]),
      }),
      executionConfig: entry.config.execution,
      klineRepository: this.klineRepository,
      orderService,
      session,
    });
    entry.engine.fills = state.fills ?? [];
    this.entries.set(session.id, entry);
    this.accountProfiles.set(session.id, entry.profile);
  }

  async #candidateSnapshot({ aliases, asOfDate, config, dataVersion }) {
    const selected = await this.selectionPipeline.select({
      asOfDate,
      config: config.selection ?? {},
      dataVersion,
      viewAll: true,
    });
    const rawCandidates = selected.pagination.items;
    const identities = aliases.register(rawCandidates.map((candidate) => ({ code: candidate.code, market: candidate.market })));
    const candidates = rawCandidates.map((candidate, index) => candidateDto(
      { ...candidate, qualityIssues: selected.qualityIssues, rank: index + 1 },
      identities[index],
    ));
    return Object.freeze({
      asOfDate,
      candidates: Object.freeze(candidates),
      configHash: selected.configHash,
      dataMode: "legacy_approximate",
      dataVersion,
      qualityIssues: selected.qualityIssues,
    });
  }

  async createSession(input) {
    const startDate = input.startDate;
    const endDate = input.endDate;
    const calendar = await LegacyTradingCalendar.fromRepository({
      endDate,
      marketDataRepository: this.klineRepository,
      securities: input.calendarSecurities ?? [{ code: "000001", market: 0 }],
      startDate,
    });
    if (!calendar.has(startDate) || calendar.dates.length < 2) {
      throw httpError("data_gate_failed", "The selected range does not contain enough trading dates.", 422, ["insufficient_trading_calendar"]);
    }
    const aliases = new CandidateAliasRegistry({ identityResolver: (security) => this.identityDirectory.lookup(security) });
    const dataVersion = input.dataVersion ?? "existing-data-current";
    if (input.prepareSelection !== false) {
      await this.selectionPipeline.prepare?.({ dates: calendar.dates, config: input.selection ?? {}, dataVersion });
    }
    const candidateSnapshot = input.prepareSelection === false
      ? Object.freeze({
        asOfDate: startDate, candidates: Object.freeze([]), configHash: digest(input.selection ?? {}),
        dataMode: "legacy_approximate", dataVersion, qualityIssues: Object.freeze([]),
      })
      : await this.#candidateSnapshot({ aliases, asOfDate: startDate, config: input, dataVersion });
    const session = new SimulatorSession({
      candidateSnapshot,
      dates: calendar.dates,
      mode: input.mode ?? SessionMode.MANUAL,
      startDate,
    });
    const account = new Account({ initialCash: input.initialCash ?? 100000 });
    const orderService = new OrderApplicationService({ account, aliases, session });
    const entry = {
      account,
      accountHistory: [{ date: session.clock.currentDate, ...account.snapshot() }],
      aliases,
      config: input,
      dataVersion,
      orderService,
      session,
      watchlist: new Set(),
    };
    entry.engine = new TradingSessionEngine({
      account,
      candidateSnapshotFactory: (date) => this.#candidateSnapshot({ aliases, asOfDate: date, config: input, dataVersion }),
      executionConfig: input.execution,
      klineRepository: this.klineRepository,
      orderService,
      session,
    });
    this.entries.set(session.id, entry);
    this.repository?.saveSession(session.snapshot(), { config: input });
    return this.getSession(session.id);
  }

  entry(sessionId) {
    const entry = this.entries.get(sessionId);
    if (!entry) throw httpError("session_not_found", "Session was not found.", 404);
    return entry;
  }

  getSession(sessionId) {
    return sessionDto(this.entry(sessionId));
  }

  completeDecision(sessionId, { expectedVersion }) {
    const entry = this.entry(sessionId);
    entry.session.completeDecision({ expectedVersion });
    this.repository?.saveSession(entry.session.snapshot(), { config: entry.config, state: entry.profile ? this.#runtimeState(entry) : entry.session.snapshot() });
    return this.getSession(sessionId);
  }

  async advance(sessionId, { expectedVersion }) {
    const entry = this.entry(sessionId);
    await entry.engine.advance({ expectedVersion });
    entry.accountHistory.push({ date: entry.session.clock.currentDate, ...entry.account.snapshot() });
    this.#persistTradingState(entry);
    return this.getSession(sessionId);
  }

  #persistTradingState(entry) {
    if (!this.repository) return;
    this.repository.transaction(() => {
      for (const order of entry.orderService.orders.values()) this.repository.saveOrder(entry.session.id, order);
      for (const fill of entry.engine.fills) this.repository.saveFill(entry.session.id, fill);
      const snapshot = entry.account.snapshot();
      this.repository.replacePositions(entry.session.id, accountDto(snapshot, entry.aliases).positions);
      this.repository.saveAccountSnapshot(entry.session.id, entry.session.clock.currentDate, snapshot);
      this.repository.saveSession(entry.session.snapshot(), { config: entry.config, state: entry.profile ? this.#runtimeState(entry) : entry.session.snapshot() });
    });
  }

  getCandidates(sessionId, options = {}) {
    const snapshot = this.entry(sessionId).session.candidateSnapshot;
    return { ...snapshot, pagination: paginate(snapshot.candidates, options), candidates: undefined };
  }

  async getChart(sessionId, candidateId) {
    const entry = this.entry(sessionId);
    const security = entry.aliases.resolve(candidateId);
    if (!security) throw httpError("unknown_candidate", "Candidate was not found in this session.", 404);
    const identity = entry.aliases.publicForSecurity(security);
    const endDate = entry.session.clock.currentDate;
    const [dailyHistory, yearlyHistory] = await Promise.all([
      this.klineRepository.getLegacyHistory({ ...security, endDate, period: "daily" }),
      this.klineRepository.getLegacyHistory({ ...security, endDate, period: "yearly" }),
    ]);
    const watchlistItem = this.#watchlistItem(entry, candidateId);
    const currentCandidate = entry.session.candidateSnapshot.candidates.find((item) => item.candidateId === candidateId);
    const signal = currentCandidate
      ? {
        evidence: currentCandidate.evidence,
        signalClose: currentCandidate.evidence.today_close,
        signalDate: currentCandidate.evidence.today_date,
        signalSource: "exact",
        strategyId: entry.profile?.strategyId ?? null,
      }
      : watchlistItem;
    const daily = dailyChartWindow(dailyHistory.bars, signal?.signalDate, 240);
    const yearly = yearlyChartWindow(yearlyHistory.bars, dailyHistory.bars, endDate);
    const latestBar = daily.at(-1);
    const signalIndex = signal?.signalDate ? entry.session.clock.dates.indexOf(signal.signalDate) : -1;
    const signalClose = Number(signal?.signalClose);
    const currentClose = Number(latestBar?.close);
    const hasPerformance = signalIndex >= 0 && Number.isFinite(signalClose) && Number.isFinite(currentClose);
    const rawHolding = entry.account.position(security);
    const holding = rawHolding?.quantity > 0
      ? rawHolding.mark(Number.isFinite(currentClose) ? currentClose : rawHolding.averageCost)
      : null;
    const openedDate = positionCycleOpenDates({ fills: entry.engine.fills, orders: entry.orderService.orders })
      .get(`${security.market}.${security.code}`);
    const openedIndex = openedDate ? entry.session.clock.dates.indexOf(openedDate) : -1;
    const openCycle = reconstructStockCycles(entry).find((cycle) => cycle.status === "open"
      && cycle.security.code === security.code && Number(cycle.security.market) === Number(security.market));
    const detail = {
      boll: {
        aboveMiddle: Number.isFinite(latestBar?.bollMiddle) ? latestBar.close > latestBar.bollMiddle : null,
        middle: latestBar?.bollMiddle ?? null,
      },
      canBuy: Boolean(currentCandidate || watchlistItem),
      currentClose: Number.isFinite(currentClose) ? currentClose : null,
      currentPriceDayOffset: latestBar ? entry.session.clock.index - entry.session.clock.dates.indexOf(latestBar.date) : null,
      isCurrentCandidate: Boolean(currentCandidate),
      isWatchlisted: Boolean(watchlistItem),
      holding: holding ? {
        averageCost: holding.averageCost,
        buyCount: openCycle?.buyCount ?? 0,
        holdingDays: openedIndex < 0 ? null : entry.session.clock.index - openedIndex + 1,
        quantity: holding.quantity,
        unrealizedPnl: holding.unrealizedPnl,
        unrealizedPnlPct: holding.averageCost > 0 ? (holding.unrealizedPnl / (holding.averageCost * holding.quantity)) * 100 : null,
      } : null,
      signal: signalIndex < 0 ? null : {
        changeAmount: hasPerformance ? currentClose - signalClose : null,
        changePct: hasPerformance ? ((currentClose - signalClose) / signalClose) * 100 : null,
        dayIndex: signalIndex + 1,
        daysSince: entry.session.clock.index - signalIndex,
        evidence: signal.evidence ?? null,
        signalClose,
        source: signal.signalSource ?? "exact",
      },
    };
    return chartDto({ ...identity, daily, detail, yearly });
  }

  async getPortfolio(sessionId) {
    const entry = this.entry(sessionId);
    const active = [...entry.account.positions.entries()].filter(([, position]) => position.quantity > 0);
    const quotes = await Promise.all(active.map(async ([key, position]) => {
      const history = await this.klineRepository.getLegacyHistory({
        ...position.security,
        endDate: entry.session.clock.currentDate,
        limit: 1,
        period: "daily",
      });
      return [key, history.bars.at(-1) ?? null];
    }));
    const prices = Object.fromEntries(quotes.filter(([, bar]) => Number.isFinite(bar?.close)).map(([key, bar]) => [key, bar.close]));
    const snapshot = entry.account.snapshot({ prices });
    const dto = accountDto(snapshot, entry.aliases);
    const quoteMap = new Map(quotes);
    const openedAt = positionCycleOpenDates({ fills: entry.engine.fills, orders: entry.orderService.orders });
    for (const position of dto.positions) {
      const security = entry.aliases.resolve(position.candidateId);
      const key = `${security.market}.${security.code}`;
      const bar = quoteMap.get(key);
      const openedDate = openedAt.get(key);
      const openedIndex = openedDate ? entry.session.clock.dates.indexOf(openedDate) : -1;
      const priceIndex = bar ? entry.session.clock.dates.indexOf(bar.date) : -1;
      const costBasis = position.averageCost * position.quantity;
      position.currentPrice = Number.isFinite(bar?.close) ? bar.close : position.averageCost;
      position.holdingDays = openedIndex < 0 ? null : entry.session.clock.index - openedIndex + 1;
      position.priceDayOffset = priceIndex < 0 ? null : entry.session.clock.index - priceIndex;
      position.unrealizedPnlPct = costBasis > 0 ? (position.unrealizedPnl / costBasis) * 100 : null;
    }
    return dto;
  }

  listStrategies() {
    return { strategies: [...this.strategies.values()].map((strategy) => ({
      ...strategy,
      buildProgress: this.strategyBuilds.get(strategy.id) ?? null,
      description: compileStrategy(strategy.config?.strategy).description,
      isDefault: strategy.id === DEFAULT_STRATEGY_ID,
    })) };
  }

  getStrategyBuilderCatalog() {
    const { templates, ...catalog } = STRATEGY_BUILDER_CATALOG;
    void templates;
    return catalog;
  }

  validateStrategy(input) {
    const compiled = compileStrategy(input?.strategy ?? input);
    return { definition: compiled.definition, description: compiled.description, requirements: compiled.requirements };
  }

  listStrategyTemplates() {
    return { templates: [...this.strategyTemplates.values()].filter((template) => !template.archived) };
  }

  listStrategyTemplateRevisions(templateId) {
    if (!this.strategyTemplates.has(templateId)) throw httpError("strategy_template_not_found", "Strategy template was not found.", 404);
    return { revisions: this.repository?.listStrategyTemplateRevisions?.(templateId) ?? [] };
  }

  listStrategyRevisions(strategyId) {
    if (!this.strategies.has(strategyId)) throw httpError("strategy_not_found", "Strategy was not found.", 404);
    return { revisions: this.repository?.listStrategyRevisions?.(strategyId) ?? [] };
  }

  saveStrategyTemplate(input, id = randomUUID()) {
    const previous = this.strategyTemplates.get(id);
    if (previous?.isSystem) throw httpError("system_strategy_template_immutable", "System strategy templates cannot be edited.", 409);
    const compiled = compileStrategy(input.definition);
    if (compiled.definition.type !== "composite") throw httpError("invalid_strategy_template", "Custom templates must use the V3 composite format.", 422);
    const template = {
      archived: false,
      definition: compiled.definition,
      description: input.description?.trim() || compiled.description,
      id,
      isSystem: false,
      name: input.name.trim(),
      version: (previous?.version ?? 0) + 1,
      currentRevision: (previous?.currentRevision ?? previous?.version ?? 0) + 1,
    };
    this.strategyTemplates.set(id, template);
    this.repository?.transaction(() => {
      this.repository.saveStrategyTemplate(template);
      this.repository.saveStrategyTemplateRevision?.(template);
    });
    return template;
  }

  deleteStrategyTemplate(id) {
    const template = this.strategyTemplates.get(id);
    if (!template) throw httpError("strategy_template_not_found", "Strategy template was not found.", 404);
    if (template.isSystem) throw httpError("system_strategy_template_immutable", "System strategy templates cannot be deleted.", 409);
    template.archived = true;
    this.repository?.saveStrategyTemplate?.(template);
  }

  async getDataStatus({ refresh = false } = {}) {
    const status = await this.dataStatusService.get({ refresh });
    const strategyUniverse = status.strategyUniverse
      ? {
        ...status.strategyUniverse,
        securities: (status.strategyUniverse.codes ?? []).map((code) => this.identityDirectory.lookup(securityFromCode(code))),
      }
      : null;
    return { ...status, strategyUniverse };
  }

  async getDataStatusDetails(options) {
    const detail = await this.dataStatusService.getDetails(options);
    return {
      ...detail,
      items: detail.items.map((item) => ({
        ...item,
        name: this.identityDirectory.lookup(securityFromCode(item.code)).name,
      })),
    };
  }

  async getDataStockChart(code) {
    const normalizedCode = String(code ?? "").trim();
    if (!/^\d{6}$/.test(normalizedCode)) {
      throw httpError("invalid_security_code", "Security code must contain 6 digits.", 400);
    }
    const security = securityFromCode(normalizedCode);
    const [dailyHistory, yearlyHistory] = await Promise.all([
      this.klineRepository.getLegacyHistory({ ...security, endDate: "9999-12-31", period: "daily" }),
      this.klineRepository.getLegacyHistory({ ...security, endDate: "9999-12-31", period: "yearly" }),
    ]);
    if (dailyHistory.bars.length === 0 && yearlyHistory.bars.length === 0) {
      throw httpError("stock_data_not_found", "No kline data was found for this security.", 404);
    }
    const latestDate = dailyHistory.bars.at(-1)?.date ?? yearlyHistory.bars.at(-1)?.date;
    const identity = this.identityDirectory.lookup(security);
    const daily = dailyChartWindow(dailyHistory.bars, null, 240);
    const yearly = yearlyChartWindow(yearlyHistory.bars, dailyHistory.bars, latestDate);
    return {
      ...chartDto({
        alias: identity.name ?? identity.code,
        candidateId: null,
        daily,
        security: identity,
        yearly,
      }),
      qualityIssues: [...new Set([...dailyHistory.qualityIssues, ...yearlyHistory.qualityIssues])],
      range: {
        daily: { count: dailyHistory.bars.length, end: dailyHistory.bars.at(-1)?.date ?? null, start: dailyHistory.bars[0]?.date ?? null },
        yearly: { count: yearlyHistory.bars.length, end: yearlyHistory.bars.at(-1)?.date ?? null, start: yearlyHistory.bars[0]?.date ?? null },
      },
    };
  }

  getProxyQuality() { return { job: this.proxyQualityService.status() }; }

  refreshProxyQuality() { return { job: this.proxyQualityService.start() }; }

  listStrategySyncs() {
    return { jobs: this.strategySyncOrchestrator.list() };
  }

  getStrategySync(strategyId) {
    if (!this.strategies.has(strategyId)) throw httpError("strategy_not_found", "Strategy was not found.", 404);
    return { job: this.strategySyncOrchestrator.latest(strategyId) };
  }

  startStrategySync(strategyId) {
    const strategy = this.strategies.get(strategyId);
    if (!strategy || strategy.archived) throw httpError("strategy_not_found", "Strategy was not found.", 404);
    if (strategy.status !== "ready") throw httpError("strategy_not_ready", "Strategy index must be ready before syncing data.", 409);
    const compiled = compileStrategy(strategy.config?.strategy);
    const downTransitions = strategy.config?.strategy?.downTransitions ?? strategy.config?.strategy?.rules?.find((rule) => rule.type === "sequence_compare")?.params?.transitions ?? 3;
    const marketBoards = Object.entries(normalizeMarketBoards(strategy.config?.universe))
      .filter(([, enabled]) => enabled)
      .map(([board]) => board);
    return { job: this.strategySyncOrchestrator.start({
      strategyId,
      strategyDefinition: compiled.definition,
      downTransitions,
      marketBoards,
      afterSync: async ({ updatedCodes = [] } = {}) => {
        if (updatedCodes.length > 0) {
          await this.#queueStrategyBuild(strategyId, { force: true, updatedCodes });
        }
        this.dataStatusService.invalidate();
      },
    }) };
  }

  saveStrategy(input, id = randomUUID()) {
    const previous = this.strategies.get(id);
    if (previous?.isSystem) throw httpError("system_strategy_immutable", "System strategies cannot be edited.", 409);
    const compiled = compileStrategy(input.config?.strategy);
    const universe = normalizeMarketBoards(input.config?.universe, DEFAULT_STRATEGY_MARKET_BOARDS);
    if (!Object.values(universe).some(Boolean)) {
      throw httpError("empty_strategy_universe", "At least one market board must be enabled.", 422);
    }
    const config = {
      ...input.config,
      strategy: compiled.definition,
      universe,
    };
    const revision = (previous?.activeRevision ?? previous?.version ?? 0) + 1;
    const strategy = { activeRevision: revision, config, dataVersion: "existing-data-current", failureReason: null,
      id, isSystem: false, name: input.name.trim(), status: "building", version: (previous?.version ?? 0) + 1 };
    if (!previous) {
      this.strategies.set(id, strategy);
      this.repository?.saveStrategy?.(strategy);
    }
    this.repository?.saveStrategyRevision?.({
      config,
      revision,
      schemaVersion: compiled.definition.schemaVersion ?? 1,
      status: "building",
      strategyId: id,
      templateId: input.config?.templateOrigin?.id,
      templateRevision: input.config?.templateOrigin?.revision,
    });
    this.#enqueueStrategyBuild(id, previous ? { candidateStrategy: strategy } : {});
    return strategy;
  }

  async #startStrategyBuild(strategyId, { candidateStrategy = null, force = false, updatedCodes = null, verifySignals = false } = {}) {
    const previousStrategy = this.strategies.get(strategyId);
    const strategy = candidateStrategy ?? previousStrategy;
    if (!strategy) throw httpError("strategy_not_found", "Strategy was not found.", 404);
    const shadowBuild = candidateStrategy !== null && previousStrategy !== undefined;
    const previousIndex = this.strategyIndexes.get(strategyId);
    const incremental = force && Array.isArray(updatedCodes) && previousIndex instanceof Map;
    const build = { algorithmVersion: strategyAlgorithmVersion(strategy), completed: 0, dataVersion: "existing-data-current", failureReason: null,
      id: randomUUID(), phase: "queued", signalCount: 0, status: "building",
      strategyId, strategyVersion: strategy.version, total: 0 };
    strategy.status = "building";
    strategy.failureReason = null;
    this.strategyBuilds.set(strategyId, build);
    if (!shadowBuild) this.repository?.saveStrategy?.(strategy);
    this.repository?.saveStrategyBuild?.(build);
    try {
      let verificationIndex = null;
      if (verifySignals) {
        verificationIndex = await this.selectionPipeline.buildAll({
          config: previousStrategy.config,
          dataVersion: build.dataVersion,
          onProgress: (progress) => {
            Object.assign(build, progress, { phase: `v2_${progress.phase}` });
            this.repository?.saveStrategyBuild?.(build);
          },
        });
      }
      const index = await this.selectionPipeline.buildAll({
        config: strategy.config,
        dataVersion: build.dataVersion,
        securityCodes: incremental ? updatedCodes : null,
        onProgress: (progress) => {
          Object.assign(build, progress, { phase: verifySignals ? `v3_${progress.phase}` : progress.phase });
          this.repository?.saveStrategyBuild?.(build);
        },
      });
      if (incremental) {
        index.byDate = mergeStrategySignals(previousIndex, index.byDate, updatedCodes);
        index.signalCount = [...index.byDate.values()].reduce((sum, items) => sum + items.length, 0);
      }
      if (verifySignals && signalIdentity(verificationIndex.byDate) !== signalIdentity(index.byDate)) {
        throw httpError("strategy_migration_mismatch", "V3 shadow build produced different signal identities; the V2 revision remains active.", 409);
      }
      build.status = "ready";
      build.phase = "completed";
      build.signalCount = index.signalCount;
      this.repository?.transaction(() => {
        this.repository.replaceStrategySignals(build, index.byDate);
        this.repository.saveStrategyBuild(build);
      });
      this.strategyIndexes.set(strategyId, index.byDate);
      strategy.status = "ready";
      strategy.dataVersion = build.dataVersion;
      this.strategies.set(strategyId, strategy);
      this.repository?.saveStrategy?.(strategy);
      this.repository?.saveStrategyRevision?.({
        config: strategy.config,
        revision: strategy.activeRevision ?? strategy.version,
        schemaVersion: strategy.config.strategy?.schemaVersion ?? 1,
        status: "ready",
        strategyId,
      });
      for (const profile of this.accountProfiles.values()) {
        if (profile.strategyId !== strategyId) continue;
        profile.calculatedDate = null;
        this.repository?.saveAccountProfile?.(profile);
      }
      return build;
    } catch (error) {
      build.status = "failed";
      build.phase = "failed";
      build.failureReason = error.message;
      strategy.status = "failed";
      strategy.failureReason = error.message;
      this.repository?.saveStrategyBuild?.(build);
      if (!shadowBuild) this.repository?.saveStrategy?.(strategy);
      this.repository?.saveStrategyRevision?.({
        config: strategy.config,
        failureReason: error.message,
        revision: strategy.activeRevision ?? strategy.version,
        schemaVersion: strategy.config.strategy?.schemaVersion ?? 1,
        status: "failed",
        strategyId,
      });
      throw error;
    }
  }

  #queueStrategyBuild(strategyId, options = {}) {
    const task = this.strategyBuildQueue.then(() => this.#startStrategyBuild(strategyId, options));
    this.strategyBuildQueue = task.catch(() => null);
    return task;
  }

  #enqueueStrategyBuild(strategyId, options = {}) {
    void this.#queueStrategyBuild(strategyId, options);
    return this.getStrategyBuild(strategyId);
  }

  getStrategyBuild(strategyId) {
    const strategy = this.strategies.get(strategyId);
    if (!strategy) throw httpError("strategy_not_found", "Strategy was not found.", 404);
    return { build: this.strategyBuilds.get(strategyId) ?? null, strategy };
  }

  rebuildStrategy(strategyId) {
    return this.#enqueueStrategyBuild(strategyId, { force: true });
  }

  deleteStrategy(id) {
    const strategy = this.strategies.get(id);
    if (!strategy) throw httpError("strategy_not_found", "Strategy was not found.", 404);
    if (strategy.isSystem) throw httpError("system_strategy_immutable", "System strategies cannot be deleted.", 409);
    strategy.archived = true;
    this.repository?.saveStrategy?.(strategy);
    return null;
  }

  async createAccount(input) {
    const allDates = (await LegacyTradingCalendar.fromRepository({
      endDate: "9999-12-31",
      marketDataRepository: this.klineRepository,
      securities: [{ code: "000001", market: 0 }],
    })).dates;
    if (allDates.length < 61) throw httpError("insufficient_trading_calendar", "At least 61 trading dates are required.", 422);
    const latestStartIndex = allDates.length - 61;
    const earliestYear = Number(allDates[0].slice(0, 4)) + 4;
    const earliestIndex = allDates.findIndex((date) => Number(date.slice(0, 4)) >= earliestYear);
    let startIndex;
    if (input.startMode === "specified") {
      startIndex = allDates.findIndex((date) => date >= input.startDate);
      if (startIndex < earliestIndex || startIndex > latestStartIndex) {
        throw httpError("invalid_account_start_date", "The selected date lacks required history or 60 future trading dates.", 422);
      }
    } else {
      startIndex = randomInt(earliestIndex, latestStartIndex + 1);
    }
    const strategy = this.strategies.get(input.strategyId ?? DEFAULT_STRATEGY_ID);
    if (!strategy) throw httpError("strategy_not_found", "Strategy was not found.", 404);
    if (strategy.status !== "ready" || !this.strategyIndexes.has(strategy.id)) {
      throw httpError("strategy_index_not_ready", "The selected strategy index is not ready.", 409);
    }
    if (input.startMode === "random") {
      const eligible = [...this.strategyIndexes.get(strategy.id).keys()]
        .map((date) => allDates.indexOf(date))
        .filter((index) => index >= earliestIndex && index <= latestStartIndex);
      if (eligible.length === 0) throw httpError("strategy_has_no_eligible_start", "The strategy has no signal date with 60 future trading dates.", 422);
      startIndex = eligible[randomInt(eligible.length)];
    }
    const startDate = allDates[startIndex];
    const account = await this.createSession({
      endDate: allDates.at(-1),
      initialCash: input.initialCash,
      mode: "manual",
      prepareSelection: false,
      selection: strategy.config,
      startDate,
    });
    const entry = this.entry(account.id);
    entry.engine.candidateSnapshotFactory = async (date) => Object.freeze({
      asOfDate: date,
      candidates: Object.freeze([]),
      configHash: digest(entry.config.selection),
      dataMode: "legacy_approximate",
      dataVersion: entry.dataVersion,
      qualityIssues: Object.freeze([]),
    });
    const profile = {
      accountId: account.id,
      actualStartDate: startDate,
      calculatedDate: null,
      name: input.name.trim(),
      requestedStartDate: input.startDate ?? null,
      startMode: input.startMode,
      strategyId: strategy.id,
    };
    entry.profile = profile;
    this.accountProfiles.set(account.id, profile);
    this.repository?.saveAccountProfile?.(profile);
    this.repository?.saveSession(entry.session.snapshot(), { config: entry.config, state: this.#runtimeState(entry) });
    return this.getAccount(account.id);
  }

  accountDto(entry) {
    const session = this.getSession(entry.session.id);
    return {
      ...session,
      candidateCount: this.#candidateCount(entry),
      candidateSnapshot: entry.profile?.calculatedDate === entry.session.clock.currentDate ? session.candidateSnapshot : null,
      name: entry.profile?.name ?? "模拟账号",
      dayIndex: entry.session.clock.index + 1,
      startMode: entry.profile?.startMode ?? "specified",
      strategyId: entry.profile?.strategyId ?? null,
    };
  }

  #candidateCount(entry) {
    const strategy = this.strategies.get(entry.profile?.strategyId);
    if (!strategy || strategy.status !== "ready") return null;
    const indexed = this.strategyIndexes.get(strategy.id)?.get(entry.session.clock.currentDate) ?? [];
    const limit = Number.isInteger(strategy.config.limit) && strategy.config.limit > 0 ? strategy.config.limit : indexed.length;
    return Math.min(indexed.length, limit);
  }

  getAccount(accountId) {
    return this.accountDto(this.entry(accountId));
  }

  listAccounts() {
    return { accounts: [...this.accountProfiles.keys()].map((id) => this.getAccount(id)) };
  }

  async calculateAccountCandidates(accountId, { expectedVersion, strategyId }) {
    const entry = this.entry(accountId);
    entry.session.assertVersion(expectedVersion);
    const strategy = this.strategies.get(strategyId);
    if (!strategy) throw httpError("strategy_not_found", "Strategy was not found.", 404);
    if (strategy.status !== "ready") throw httpError("strategy_index_not_ready", "The selected strategy index is not ready.", 409);
    entry.session.candidateSnapshot = this.#indexedSnapshot(entry, strategy, entry.session.clock.currentDate);
    entry.profile.calculatedDate = entry.session.clock.currentDate;
    entry.profile.strategyId = strategy.id;
    entry.config.selection = strategy.config;
    this.repository?.saveAccountProfile?.(entry.profile);
    this.repository?.saveSession(entry.session.snapshot(), { config: entry.config, state: this.#runtimeState(entry) });
    const calculation = {
      accountId, id: randomUUID(), resultCount: entry.session.candidateSnapshot.candidates.length,
      status: "completed", strategyId, tradingDate: entry.session.clock.currentDate,
    };
    this.repository?.saveCandidateCalculation?.(calculation);
    return { calculation, snapshot: entry.session.candidateSnapshot };
  }

  getAccountCandidates(accountId, options = {}) {
    const entry = this.entry(accountId);
    const strategy = this.strategies.get(entry.profile.strategyId);
    if (!strategy || strategy.status !== "ready") return { asOfDate: entry.session.clock.currentDate, calculated: false, pagination: paginate([], options) };
    if (entry.profile.calculatedDate !== entry.session.clock.currentDate) {
      entry.session.candidateSnapshot = this.#indexedSnapshot(entry, strategy, entry.session.clock.currentDate);
      entry.profile.calculatedDate = entry.session.clock.currentDate;
      this.repository?.saveAccountProfile?.(entry.profile);
    }
    return { ...this.getCandidates(accountId, options), calculated: true };
  }

  #indexedSnapshot(entry, strategy, date) {
    const indexed = this.strategyIndexes.get(strategy.id)?.get(date) ?? [];
    const limit = Number.isInteger(strategy.config.limit) && strategy.config.limit > 0 ? strategy.config.limit : indexed.length;
    const raw = indexed.slice(0, limit);
    const identities = entry.aliases.register(raw.map((candidate) => ({ code: candidate.code, market: candidate.market })));
    const candidates = raw.map((candidate, index) => candidateDto({ ...candidate, rank: index + 1 }, identities[index]));
    return Object.freeze({ asOfDate: date, candidates: Object.freeze(candidates), configHash: digest(strategy.config),
      dataMode: "legacy_approximate", dataVersion: strategy.dataVersion, qualityIssues: Object.freeze([]) });
  }

  #inferWatchlistSignal(entry, candidateId) {
    const security = entry.aliases.resolve(candidateId);
    const index = this.strategyIndexes.get(entry.profile?.strategyId);
    if (!security || !index) return null;
    let match = null;
    for (const [date, candidates] of index) {
      if (date < entry.profile.actualStartDate || date > entry.session.clock.currentDate) continue;
      const candidate = candidates.find((item) => item.code === security.code && Number(item.market) === Number(security.market));
      if (candidate) match = { candidate, date };
    }
    if (!match) return null;
    return {
      evidence: match.candidate.evidence,
      signalClose: match.candidate.evidence.today_close,
      signalDate: match.date,
      signalSource: "inferred",
      strategyId: entry.profile.strategyId,
    };
  }

  #watchlistItem(entry, candidateId, storedItems = null) {
    if (!entry.watchlist?.has(candidateId)) return null;
    let item = storedItems?.get(candidateId)
      ?? (storedItems ? null : (this.repository?.listWatchlist?.(entry.session.id) ?? []).find((row) => row.candidateId === candidateId));
    if (!item?.signalDate) {
      const inferred = this.#inferWatchlistSignal(entry, candidateId);
      if (inferred) {
        const security = entry.aliases.resolve(candidateId);
        const identity = entry.aliases.publicForSecurity(security);
        this.repository?.saveWatchlistItem?.(entry.session.id, { ...identity, ...inferred, security });
        item = { ...item, ...inferred };
      }
    }
    return item ?? { candidateId };
  }

  addWatchlist(accountId, candidateIds) {
    const entry = this.entry(accountId);
    for (const candidateId of [...new Set(candidateIds)]) {
      const security = entry.aliases.resolve(candidateId);
      if (!security) throw httpError("unknown_candidate", "Candidate was not found in this account.", 404);
      const identity = entry.aliases.publicForSecurity(security);
      if (!identity) throw httpError("unknown_candidate", "Candidate was not found in this account.", 404);
      entry.watchlist.add(candidateId);
      const candidate = entry.session.candidateSnapshot.candidates.find((item) => item.candidateId === candidateId);
      this.repository?.saveWatchlistItem?.(accountId, {
        ...identity,
        evidence: candidate?.evidence ?? null,
        security,
        signalClose: candidate?.evidence?.today_close ?? null,
        signalDate: candidate?.evidence?.today_date ?? null,
        signalSource: candidate ? "exact" : null,
        strategyId: candidate ? entry.profile?.strategyId : null,
      });
    }
    this.repository?.saveSession(entry.session.snapshot(), { config: entry.config, state: this.#runtimeState(entry) });
    return this.listWatchlist(accountId);
  }

  removeWatchlist(accountId, candidateId) {
    const entry = this.entry(accountId);
    entry.watchlist.delete(candidateId);
    this.repository?.deleteWatchlistItem?.(accountId, candidateId);
    this.repository?.saveSession(entry.session.snapshot(), { config: entry.config, state: this.#runtimeState(entry) });
    return this.listWatchlist(accountId);
  }

  async listWatchlist(accountId) {
    const startedAt = process.hrtime.bigint();
    const entry = this.entry(accountId);
    const storedStartedAt = process.hrtime.bigint();
    const storedItems = new Map((this.repository?.listWatchlist?.(entry.session.id) ?? [])
      .map((item) => [item.candidateId, item]));
    const storageMs = Number(process.hrtime.bigint() - storedStartedAt) / 1e6;
    const openedAt = positionCycleOpenDates({ fills: entry.engine.fills, orders: entry.orderService.orders });
    const cycles = reconstructStockCycles(entry);
    const items = await Promise.all([...entry.watchlist].map(async (candidateId) => {
      const item = this.#watchlistItem(entry, candidateId, storedItems);
      const security = entry.aliases.resolve(candidateId);
      const identity = entry.aliases.publicForSecurity(security);
      const signalIndex = item?.signalDate ? entry.session.clock.dates.indexOf(item.signalDate) : -1;
      const history = await this.klineRepository.getLegacyHistory({
        ...security, endDate: entry.session.clock.currentDate, limit: 39, period: "daily",
      });
      const bollRows = dailyChartWindow(history.bars);
      const latest = bollRows.at(-1);
      const previous = bollRows.at(-2);
      const currentClose = Number(latest?.close);
      const signalClose = Number(item?.signalClose);
      const rawHolding = entry.account.position(security);
      const holding = rawHolding?.quantity > 0
        ? rawHolding.mark(Number.isFinite(currentClose) ? currentClose : rawHolding.averageCost)
        : null;
      const key = `${security.market}.${security.code}`;
      const openedIndex = entry.session.clock.dates.indexOf(openedAt.get(key));
      const cycle = cycles.find((source) => source.status === "open"
        && source.security.code === security.code && Number(source.security.market) === Number(security.market));
      return {
        ...identity,
        detail: {
          boll: {
            aboveMiddle: Number.isFinite(latest?.bollMiddle) ? latest.close > latest.bollMiddle : null,
            justCrossedMiddle: justCrossedBollMiddle(previous, latest),
            middle: latest?.bollMiddle ?? null,
          },
          currentClose: Number.isFinite(currentClose) ? currentClose : null,
          holding: holding ? {
            availableQuantity: holding.availableQuantity,
            averageCost: holding.averageCost,
            buyCount: cycle?.buyCount ?? 0,
            holdingDays: openedIndex < 0 ? null : entry.session.clock.index - openedIndex + 1,
            quantity: holding.quantity,
            unrealizedPnl: holding.unrealizedPnl,
            unrealizedPnlPct: holding.averageCost > 0 ? (holding.unrealizedPnl / (holding.averageCost * holding.quantity)) * 100 : null,
          } : null,
          signal: signalIndex < 0 ? null : {
            changeAmount: Number.isFinite(currentClose) && Number.isFinite(signalClose) ? currentClose - signalClose : null,
            changePct: Number.isFinite(currentClose) && Number.isFinite(signalClose) && signalClose > 0
              ? ((currentClose - signalClose) / signalClose) * 100 : null,
            dayIndex: signalIndex + 1,
            daysSince: entry.session.clock.index - signalIndex,
            signalClose,
            source: item.signalSource,
          },
        },
        signal: signalIndex < 0 ? null : {
          dayIndex: signalIndex + 1,
          daysSince: entry.session.clock.index - signalIndex,
          source: item.signalSource,
        },
      };
    }));
    const result = { items: prioritizeHeldWatchlist(items) };
    this.#reportPerformance("list_watchlist", startedAt, { itemCount: items.length, storageMs });
    return result;
  }

  async advanceAccount(accountId, { expectedVersion }) {
    const startedAt = process.hrtime.bigint();
    const entry = this.entry(accountId);
    if (entry.session.status === "waiting_for_decision") {
      entry.session.completeDecision({ expectedVersion });
      expectedVersion = entry.session.version;
    }
    const advanceStartedAt = process.hrtime.bigint();
    await this.advance(accountId, { expectedVersion });
    const advanceMs = Number(process.hrtime.bigint() - advanceStartedAt) / 1e6;
    entry.profile.calculatedDate = null;
    this.repository?.saveAccountProfile?.(entry.profile);
    const watchlistStartedAt = process.hrtime.bigint();
    const watchlist = await this.listWatchlist(accountId);
    const watchlistMs = Number(process.hrtime.bigint() - watchlistStartedAt) / 1e6;
    const response = { ...this.accountDto(entry), watchlistItems: watchlist.items };
    this.#reportPerformance("advance_account", startedAt, {
      advanceMs,
      candidateCount: response.candidateCount,
      watchlistCount: watchlist.items.length,
      watchlistMs,
    });
    return response;
  }

  #reportPerformance(operation, startedAt, details = {}) {
    if (!this.onPerformance) return;
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    this.onPerformance({
      ...Object.fromEntries(Object.entries(details).map(([key, value]) => [key,
        typeof value === "number" ? Number(value.toFixed(2)) : value])),
      durationMs: Number(durationMs.toFixed(2)),
      operation,
    });
  }

  async createOrder(sessionId, input) {
    const startedAt = process.hrtime.bigint();
    const entry = this.entry(sessionId);
    entry.session.assertVersion(input.expectedVersion);
    let priced = input;
    if (input.side === OrderSide.BUY && entry.watchlist?.has(input.candidateId)
      && !entry.session.candidateSnapshot.candidates.some((item) => item.candidateId === input.candidateId)) {
      const security = entry.aliases.resolve(input.candidateId);
      const history = await this.klineRepository.getLegacyHistory({ ...security, endDate: entry.session.clock.currentDate, period: "daily" });
      priced = { ...input, serverReferencePrice: history.bars.at(-1)?.close };
    }
    const order = entry.orderService.create(buyReservationInput(entry, priced));
    entry.session.touch({ expectedVersion: input.expectedVersion });
    const persistenceStartedAt = process.hrtime.bigint();
    this.repository?.transaction(() => {
      this.repository.saveOrder(sessionId, order);
      this.repository.saveSession(entry.session.snapshot(), { config: entry.config, state: entry.profile ? this.#runtimeState(entry) : entry.session.snapshot() });
    });
    const persistenceMs = Number(process.hrtime.bigint() - persistenceStartedAt) / 1e6;
    const response = {
      account: accountDto(entry.account.snapshot(), entry.aliases),
      order: orderDto(order),
      sessionVersion: entry.session.version,
    };
    this.#reportPerformance("create_order", startedAt, { persistenceMs, side: input.side });
    return response;
  }

  updateOrder(sessionId, orderId, input) {
    const entry = this.entry(sessionId);
    entry.session.assertVersion(input.expectedVersion);
    const current = entry.orderService.get(orderId);
    const pricedInput = current.side === OrderSide.BUY
      ? buyReservationInput(entry, { ...input, candidateId: current.candidateId, quantity: input.quantity ?? current.quantity, side: current.side })
      : input;
    const order = entry.orderService.update(orderId, pricedInput);
    entry.session.touch({ expectedVersion: input.expectedVersion });
    this.repository?.transaction(() => {
      this.repository.saveOrder(sessionId, order);
      this.repository.saveSession(entry.session.snapshot(), { config: entry.config, state: entry.profile ? this.#runtimeState(entry) : entry.session.snapshot() });
    });
    return { order: orderDto(order), sessionVersion: entry.session.version };
  }

  cancelOrder(sessionId, orderId, input) {
    const entry = this.entry(sessionId);
    entry.session.assertVersion(input.expectedVersion);
    const order = entry.orderService.cancel(orderId);
    entry.session.touch({ expectedVersion: input.expectedVersion });
    this.repository?.transaction(() => {
      this.repository.saveOrder(sessionId, order);
      this.repository.saveSession(entry.session.snapshot(), { config: entry.config, state: entry.profile ? this.#runtimeState(entry) : entry.session.snapshot() });
    });
    return { order: orderDto(order), sessionVersion: entry.session.version };
  }

  listOrders(sessionId, { status, tradingDate } = {}) {
    const entry = this.entry(sessionId);
    return {
      orders: [...entry.orderService.orders.values()]
        .filter((order) => !status || order.status === status)
        .filter((order) => !tradingDate || order.tradingDate === tradingDate)
        .map(orderDto),
    };
  }

  listFills(sessionId, { tradingDate } = {}) {
    const entry = this.entry(sessionId);
    return { fills: entry.engine.fills.filter((fill) => !tradingDate || fill.date === tradingDate) };
  }

  async skip(sessionId, { expectedVersion }) {
    const entry = this.entry(sessionId);
    if (entry.orderService.acceptedForDate(entry.session.clock.currentDate).length > 0) {
      throw httpError("accepted_orders_block_skip", "Cancel accepted orders before skipping this trading date.", 409);
    }
    entry.session.completeDecision({ expectedVersion });
    return this.advance(sessionId, { expectedVersion: entry.session.version });
  }

  async cloneSession(sessionId, { expectedVersion, selection = {} }) {
    const parent = this.entry(sessionId);
    parent.session.assertVersion(expectedVersion);
    const startDate = parent.session.clock.currentDate;
    const dates = parent.session.clock.dates.slice(parent.session.clock.index);
    const aliases = new CandidateAliasRegistry({ identityResolver: (security) => this.identityDirectory.lookup(security) });
    const identities = aliases.register(parent.session.candidateSnapshot.candidates.map((candidate) => {
      const security = parent.aliases.resolve(candidate.candidateId);
      if (!security) throw httpError("unknown_candidate", "A parent candidate mapping is unavailable.", 422);
      return security;
    }));
    const candidates = parent.session.candidateSnapshot.candidates.map((candidate, index) => ({
      ...candidate,
      alias: identities[index].alias,
      candidateId: identities[index].candidateId,
    }));
    const candidateSnapshot = Object.freeze({ ...parent.session.candidateSnapshot, candidates: Object.freeze(candidates) });
    const session = new SimulatorSession({ candidateSnapshot, dates, mode: parent.session.mode, startDate });
    const account = parent.account.clone();
    for (const position of account.positions.values()) aliases.register([position.security]);
    const config = { ...parent.config, selection };
    await this.selectionPipeline.prepare?.({ dates, config: selection, dataVersion: parent.dataVersion });
    const orderService = new OrderApplicationService({ account, aliases, session });
    const lineage = Object.freeze({ branchDate: startDate, parentSessionId: parent.session.id });
    const entry = {
      account,
      accountHistory: (parent.accountHistory ?? [{
        date: parent.session.clock.currentDate,
        ...parent.account.snapshot(),
      }]).map((snapshot) => ({ ...snapshot })),
      aliases,
      config,
      dataVersion: parent.dataVersion,
      lineage,
      orderService,
      selectionEffectiveDate: session.clock.nextDate,
      session,
    };
    entry.engine = new TradingSessionEngine({
      account,
      candidateSnapshotFactory: (date) => this.#candidateSnapshot({ aliases, asOfDate: date, config, dataVersion: entry.dataVersion }),
      executionConfig: config.execution,
      klineRepository: this.klineRepository,
      orderService,
      session,
    });
    this.entries.set(session.id, entry);
    this.repository?.transaction(() => {
      this.repository.saveSession(session.snapshot(), { config });
      this.repository.saveLineage({
        branchDate: startDate,
        configHash: digest(selection),
        parentSessionId: parent.session.id,
        sessionId: session.id,
      });
    });
    return this.getSession(session.id);
  }

  reveal(sessionId, { expectedVersion }) {
    const entry = this.entry(sessionId);
    entry.session.reveal({ expectedVersion });
    this.repository?.saveSession(entry.session.snapshot(), { config: entry.config, state: entry.profile ? this.#runtimeState(entry) : entry.session.snapshot() });
    return {
      identities: identityRows(entry),
      revealedAt: entry.session.revealedAt,
      sessionVersion: entry.session.version,
    };
  }

  async finish(sessionId, { expectedVersion }) {
    const entry = this.entry(sessionId);
    await entry.engine.finish({ expectedVersion });
    const final = { date: entry.session.clock.currentDate, ...entry.account.snapshot() };
    entry.accountHistory ??= [];
    const existing = entry.accountHistory.findIndex((snapshot) => snapshot.date === final.date);
    if (existing >= 0) entry.accountHistory[existing] = final;
    else entry.accountHistory.push(final);
    this.repository?.saveSession(entry.session.snapshot(), { config: entry.config, state: entry.profile ? this.#runtimeState(entry) : entry.session.snapshot() });
    return this.getSession(sessionId);
  }

  async getReport(sessionId) {
    const entry = this.entry(sessionId);
    return buildSessionReport(entry, { quoteFor: async (security, endDate) => {
      const history = await this.klineRepository.getLegacyHistory({ ...security, endDate, limit: 39, period: "daily" });
      const last = dailyChartWindow(history.bars).at(-1);
      return last ? {
        aboveMiddle: Number.isFinite(last.bollMiddle) ? last.close > last.bollMiddle : null,
        bollMiddle: last.bollMiddle,
        close: last.close,
      } : null;
    } });
  }

  async exportSession(sessionId, { exportRoot = path.join("var", "simulator", "exports") } = {}) {
    const report = await this.getReport(sessionId);
    await fs.mkdir(exportRoot, { recursive: true });
    const filePath = path.join(exportRoot, `${sessionId}.json`);
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await fs.rename(temporaryPath, filePath);
    return { filePath };
  }
}

module.exports = {
  SimulatorRuntimeService,
  buyReservationInput,
  dailyChartWindow,
  justCrossedBollMiddle,
  httpError,
  orderDto,
  positionCycleOpenDates,
  prioritizeHeldWatchlist,
  mergeStrategySignals,
  reservationLimitRate,
  yearlyChartWindow,
};
