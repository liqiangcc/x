"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { Account } = require("../core/account");
const { SimulatorSession } = require("../core/session");
const { SessionMode } = require("../core/enums");
const { ExistingKlineRepository } = require("../adapters/ledger/existing_kline_repository");
const { LegacyTradingCalendar } = require("../data/legacy_trading_calendar");
const { ExistingUniverseRepository } = require("../adapters/ledger/existing_universe");
const { HistoricalUniverse } = require("../selection/historical_universe");
const { CandidateSelectionPipeline, paginate } = require("../selection/pipeline");
const { CandidateAliasRegistry } = require("../selection/aliases");
const { candidateDto, chartDto, holdingDto } = require("../selection/candidate_dto");
const { calculateBollSeries } = require("../../signals/indicators/boll");
const { OrderApplicationService } = require("./orders");
const { TradingSessionEngine } = require("./sessions");
const { digest } = require("../selection/pipeline");
const { buildSessionReport, identityRows } = require("./reports");

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
    reservedAmount: order.reservedAmount,
    side: order.side,
    status: order.status,
    tradingDate: order.tradingDate,
    type: order.type,
  };
}

class SimulatorRuntimeService {
  constructor({
    klineRepository = new ExistingKlineRepository(),
    repository = null,
    selectionPipeline = null,
    universeRepository = new ExistingUniverseRepository(),
  } = {}) {
    this.klineRepository = klineRepository;
    this.repository = repository;
    this.selectionPipeline = selectionPipeline ?? new CandidateSelectionPipeline({
      historicalUniverse: new HistoricalUniverse({ repository: universeRepository }),
      klineRepository,
    });
    this.entries = new Map();
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
    const aliases = new CandidateAliasRegistry();
    const dataVersion = input.dataVersion ?? "existing-data-current";
    const candidateSnapshot = await this.#candidateSnapshot({ aliases, asOfDate: startDate, config: input, dataVersion });
    const session = new SimulatorSession({
      candidateSnapshot,
      dates: calendar.dates,
      mode: input.mode ?? SessionMode.MANUAL,
      startDate,
    });
    const account = new Account({ initialCash: input.initialCash ?? 100000 });
    const orderService = new OrderApplicationService({ account, aliases, session });
    const entry = { account, aliases, config: input, dataVersion, orderService, session };
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
    const { account, config, lineage = null, selectionEffectiveDate = null, session } = this.entry(sessionId);
    return {
      account: account.snapshot(),
      config,
      dataMode: "legacy_approximate",
      lineage,
      selectionEffectiveDate,
      ...session.snapshot(),
    };
  }

  completeDecision(sessionId, { expectedVersion }) {
    const entry = this.entry(sessionId);
    entry.session.completeDecision({ expectedVersion });
    this.repository?.saveSession(entry.session.snapshot(), { config: entry.config });
    return this.getSession(sessionId);
  }

  async advance(sessionId, { expectedVersion }) {
    const entry = this.entry(sessionId);
    await entry.engine.advance({ expectedVersion });
    this.repository?.saveSession(entry.session.snapshot(), { config: entry.config });
    return this.getSession(sessionId);
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
    const boll = calculateBollSeries(dailyHistory.bars);
    const daily = dailyHistory.bars.map((bar, index) => ({
      ...bar,
      bollLower: boll[index].lower,
      bollMiddle: boll[index].middle,
      bollUpper: boll[index].upper,
    }));
    const yearly = yearlyHistory.bars.map((bar) => ({ ...bar, year: Number(bar.date.slice(0, 4)) }));
    return chartDto({ ...identity, daily, yearly });
  }

  getPortfolio(sessionId) {
    const entry = this.entry(sessionId);
    const account = entry.account.snapshot();
    return {
      cash: account.cash,
      cashAvailable: account.cashAvailable,
      equity: account.equity,
      frozenCash: account.frozenCash,
      marketValue: account.marketValue,
      positions: account.positions.map((position) => holdingDto(position, entry.aliases.publicForSecurity(position.security))),
      realizedPnl: account.realizedPnl,
      totalFees: account.totalFees,
      unrealizedPnl: account.unrealizedPnl,
    };
  }

  createOrder(sessionId, input) {
    const entry = this.entry(sessionId);
    entry.session.assertVersion(input.expectedVersion);
    const order = entry.orderService.create(input);
    entry.session.touch({ expectedVersion: input.expectedVersion });
    this.repository?.transaction(() => {
      this.repository.saveOrder(sessionId, order);
      this.repository.saveSession(entry.session.snapshot(), { config: entry.config });
    });
    return { order: orderDto(order), sessionVersion: entry.session.version };
  }

  updateOrder(sessionId, orderId, input) {
    const entry = this.entry(sessionId);
    entry.session.assertVersion(input.expectedVersion);
    const order = entry.orderService.update(orderId, input);
    entry.session.touch({ expectedVersion: input.expectedVersion });
    this.repository?.transaction(() => {
      this.repository.saveOrder(sessionId, order);
      this.repository.saveSession(entry.session.snapshot(), { config: entry.config });
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
      this.repository.saveSession(entry.session.snapshot(), { config: entry.config });
    });
    return { order: orderDto(order), sessionVersion: entry.session.version };
  }

  cloneSession(sessionId, { expectedVersion, selection = {} }) {
    const parent = this.entry(sessionId);
    parent.session.assertVersion(expectedVersion);
    const startDate = parent.session.clock.currentDate;
    const dates = parent.session.clock.dates.slice(parent.session.clock.index);
    const aliases = new CandidateAliasRegistry();
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
    const orderService = new OrderApplicationService({ account, aliases, session });
    const lineage = Object.freeze({ branchDate: startDate, parentSessionId: parent.session.id });
    const entry = {
      account,
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
    this.repository?.saveSession(entry.session.snapshot(), { config: entry.config });
    return {
      identities: identityRows(entry),
      revealedAt: entry.session.revealedAt,
      sessionVersion: entry.session.version,
    };
  }

  async finish(sessionId, { expectedVersion }) {
    const entry = this.entry(sessionId);
    await entry.engine.finish({ expectedVersion });
    this.repository?.saveSession(entry.session.snapshot(), { config: entry.config });
    return this.getSession(sessionId);
  }

  getReport(sessionId) {
    return buildSessionReport(this.entry(sessionId));
  }

  async exportSession(sessionId, { exportRoot = path.join("var", "simulator", "exports") } = {}) {
    const report = this.getReport(sessionId);
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
  httpError,
  orderDto,
};
