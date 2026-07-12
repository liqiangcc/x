"use strict";

const { Account } = require("../core/account");
const { SimulatorSession } = require("../core/session");
const { SessionMode } = require("../core/enums");
const { ExistingKlineRepository } = require("../adapters/ledger/existing_kline_repository");
const { LegacyTradingCalendar } = require("../data/legacy_trading_calendar");

function httpError(code, message, statusCode = 422, issues = []) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  error.issues = issues;
  return error;
}

class SimulatorRuntimeService {
  constructor({ klineRepository = new ExistingKlineRepository(), repository = null } = {}) {
    this.klineRepository = klineRepository;
    this.repository = repository;
    this.entries = new Map();
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
    const candidateSnapshot = Object.freeze({ candidates: [], date: String(startDate), qualityIssues: ["candidate_scan_pending"] });
    const session = new SimulatorSession({
      candidateSnapshot,
      dates: calendar.dates,
      mode: input.mode ?? SessionMode.MANUAL,
      startDate,
    });
    const account = new Account({ initialCash: input.initialCash ?? 100000 });
    this.entries.set(session.id, { account, config: input, session });
    this.repository?.saveSession(session.snapshot(), { config: input });
    return this.getSession(session.id);
  }

  entry(sessionId) {
    const entry = this.entries.get(sessionId);
    if (!entry) throw httpError("session_not_found", "Session was not found.", 404);
    return entry;
  }

  getSession(sessionId) {
    const { account, config, session } = this.entry(sessionId);
    return {
      account: account.snapshot(),
      config,
      dataMode: "legacy_approximate",
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
    const nextDate = entry.session.clock.nextDate;
    if (!nextDate) throw httpError("end_of_calendar", "No next trading date is available.", 422);
    entry.session.advance({ candidateSnapshot: { candidates: [], date: nextDate }, expectedVersion });
    this.repository?.saveSession(entry.session.snapshot(), { config: entry.config });
    return this.getSession(sessionId);
  }
}

module.exports = {
  SimulatorRuntimeService,
  httpError,
};
