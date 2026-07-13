"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const { migrate } = require("./migrate");

const DEFAULT_DATABASE_PATH = path.join("var", "simulator", "simulator.db");

function json(value) {
  return JSON.stringify(value ?? null);
}

function parse(value) {
  return value === null || value === undefined ? null : JSON.parse(value);
}

function cents(value) {
  return Math.round(Number(value) * 100);
}

class SimulatorRepository {
  constructor({ databasePath = DEFAULT_DATABASE_PATH, db } = {}) {
    if (db) {
      this.db = db;
    } else {
      fs.mkdirSync(path.dirname(databasePath), { recursive: true });
      this.db = new Database(databasePath);
    }
    this.db.pragma("foreign_keys = ON");
    this.versions = migrate(this.db);
  }

  close() {
    this.db.close();
  }

  transaction(work) {
    return this.db.transaction(work)();
  }

  saveSession(session, { config = {}, state = session } = {}) {
    this.db.prepare(`
      INSERT INTO sessions (id, status, mode, current_date, version, config_json, state_json)
      VALUES (@id, @status, @mode, @currentDate, @version, @config, @state)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status, mode = excluded.mode, current_date = excluded.current_date,
        version = excluded.version, config_json = excluded.config_json, state_json = excluded.state_json,
        updated_at = CURRENT_TIMESTAMP
    `).run({
      config: json(config),
      currentDate: session.clock?.currentDate ?? session.currentDate,
      id: session.id,
      mode: session.mode,
      state: json(state),
      status: session.status,
      version: session.version,
    });
  }

  getSession(id) {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
    if (!row) return null;
    return {
      config: parse(row.config_json),
      currentDate: row.current_date,
      id: row.id,
      mode: row.mode,
      state: parse(row.state_json),
      status: row.status,
      version: row.version,
    };
  }

  updateSessionVersion(id, expectedVersion, patch) {
    const result = this.db.prepare(`
      UPDATE sessions SET status = @status, current_date = @currentDate, version = @nextVersion,
        state_json = @state, updated_at = CURRENT_TIMESTAMP
      WHERE id = @id AND version = @expectedVersion
    `).run({
      currentDate: patch.currentDate,
      expectedVersion,
      id,
      nextVersion: patch.version,
      state: json(patch.state ?? patch),
      status: patch.status,
    });
    return result.changes === 1;
  }

  saveCandidateSnapshot({ aliases = [], candidates = [], snapshot }) {
    this.db.prepare(`INSERT INTO candidate_snapshots
      (id, session_id, as_of_date, data_version, selection_config_hash, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)`
    ).run(snapshot.id, snapshot.sessionId, snapshot.asOfDate, snapshot.dataVersion, snapshot.selectionConfigHash, json(snapshot));
    const candidateStatement = this.db.prepare(`INSERT INTO candidates
      (snapshot_id, candidate_id, rank, evidence_json, quality_json) VALUES (?, ?, ?, ?, ?)`);
    for (const candidate of candidates) {
      candidateStatement.run(snapshot.id, candidate.candidateId, candidate.rank, json(candidate.evidence), json(candidate.qualityIssues ?? []));
    }
    const aliasStatement = this.db.prepare(`INSERT INTO candidate_aliases
      (session_id, candidate_id, alias, security_json) VALUES (?, ?, ?, ?)`);
    for (const alias of aliases) aliasStatement.run(snapshot.sessionId, alias.candidateId, alias.alias, json(alias.security));
  }

  saveLineage({ branchDate, configHash, parentSessionId, sessionId }) {
    this.db.prepare(`INSERT INTO session_lineage
      (session_id, parent_session_id, branch_date, config_hash) VALUES (?, ?, ?, ?)`
    ).run(sessionId, parentSessionId, branchDate, configHash);
  }

  saveOrder(sessionId, order) {
    this.db.prepare(`INSERT INTO orders
      (id, session_id, candidate_id, trading_date, side, quantity, reason, status, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET quantity=excluded.quantity, reason=excluded.reason,
        status=excluded.status, payload_json=excluded.payload_json`
    ).run(order.id, sessionId, order.candidateId, order.tradingDate, order.side, order.quantity, order.reason, order.status, json(order));
  }

  listOrders(sessionId) {
    return this.db.prepare("SELECT payload_json FROM orders WHERE session_id = ? ORDER BY rowid").all(sessionId).map((row) => parse(row.payload_json));
  }

  saveFill(sessionId, fill) {
    this.db.prepare(`INSERT OR REPLACE INTO fills
      (id, session_id, order_id, price_cents, quantity, fee_cents, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(fill.id, sessionId, fill.orderId, cents(fill.price), fill.quantity, cents(fill.fees.total), json(fill));
  }

  replacePositions(sessionId, positions) {
    this.db.prepare("DELETE FROM positions WHERE session_id = ?").run(sessionId);
    const statement = this.db.prepare(`INSERT INTO positions
      (session_id, candidate_id, quantity, available_quantity, average_cost_cents, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)`);
    for (const position of positions) {
      statement.run(sessionId, position.candidateId, position.quantity, position.availableQuantity, cents(position.averageCost), json(position));
    }
  }

  saveAccountSnapshot(sessionId, tradingDate, snapshot) {
    this.db.prepare(`INSERT INTO account_snapshots
      (session_id, trading_date, cash_cents, frozen_cash_cents, market_value_cents, equity_cents, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, trading_date) DO UPDATE SET cash_cents=excluded.cash_cents,
        frozen_cash_cents=excluded.frozen_cash_cents, market_value_cents=excluded.market_value_cents,
        equity_cents=excluded.equity_cents, payload_json=excluded.payload_json`
    ).run(sessionId, tradingDate, cents(snapshot.cash), cents(snapshot.frozenCash), cents(snapshot.marketValue), cents(snapshot.equity), json(snapshot));
  }

  appendEvent(sessionId, event) {
    this.db.prepare("INSERT INTO events (session_id, sequence, type, payload_json) VALUES (?, ?, ?, ?)")
      .run(sessionId, event.sequence, event.type, json(event.payload));
  }

  saveStrategy(strategy) {
    this.db.prepare(`INSERT INTO strategies (id, name, version, is_system, config_json, status, data_version, failure_reason, archived)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, version=excluded.version,
        config_json=excluded.config_json, status=excluded.status, data_version=excluded.data_version,
        failure_reason=excluded.failure_reason, archived=excluded.archived, updated_at=CURRENT_TIMESTAMP`)
      .run(strategy.id, strategy.name, strategy.version, strategy.isSystem ? 1 : 0, json(strategy.config),
        strategy.status ?? "draft", strategy.dataVersion ?? null, strategy.failureReason ?? null, strategy.archived ? 1 : 0);
  }

  listStrategies() {
    return this.db.prepare("SELECT * FROM strategies ORDER BY is_system DESC, created_at")
      .all().map((row) => ({ archived: row.archived === 1, config: parse(row.config_json), dataVersion: row.data_version, failureReason: row.failure_reason,
        id: row.id, isSystem: row.is_system === 1, name: row.name, status: row.status, version: row.version }));
  }

  deleteStrategy(id) {
    return this.db.prepare("DELETE FROM strategies WHERE id = ? AND is_system = 0").run(id).changes === 1;
  }

  saveAccountProfile(profile) {
    this.db.prepare(`INSERT INTO account_profiles
      (account_id, name, start_mode, requested_start_date, actual_start_date, calculated_date, strategy_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET name=excluded.name, calculated_date=excluded.calculated_date,
        strategy_id=excluded.strategy_id`)
      .run(profile.accountId, profile.name, profile.startMode, profile.requestedStartDate ?? null,
        profile.actualStartDate, profile.calculatedDate ?? null, profile.strategyId ?? null);
  }

  listAccountProfiles() {
    return this.db.prepare("SELECT * FROM account_profiles ORDER BY created_at DESC").all().map((row) => ({
      accountId: row.account_id, actualStartDate: row.actual_start_date, calculatedDate: row.calculated_date,
      name: row.name, requestedStartDate: row.requested_start_date, startMode: row.start_mode, strategyId: row.strategy_id,
    }));
  }

  saveWatchlistItem(accountId, item) {
    this.db.prepare(`INSERT INTO account_watchlist
      (account_id, candidate_id, alias, security_json, strategy_id, signal_date, signal_close, evidence_json, signal_source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, candidate_id) DO UPDATE SET
        alias=excluded.alias, security_json=excluded.security_json,
        strategy_id=COALESCE(account_watchlist.strategy_id, excluded.strategy_id),
        signal_date=COALESCE(account_watchlist.signal_date, excluded.signal_date),
        signal_close=COALESCE(account_watchlist.signal_close, excluded.signal_close),
        evidence_json=COALESCE(account_watchlist.evidence_json, excluded.evidence_json),
        signal_source=COALESCE(account_watchlist.signal_source, excluded.signal_source)`)
      .run(accountId, item.candidateId, item.alias, json(item.security), item.strategyId ?? null,
        item.signalDate ?? null, item.signalClose ?? null, json(item.evidence), item.signalSource ?? null);
  }

  deleteWatchlistItem(accountId, candidateId) {
    return this.db.prepare("DELETE FROM account_watchlist WHERE account_id = ? AND candidate_id = ?")
      .run(accountId, candidateId).changes === 1;
  }

  listWatchlist(accountId) {
    return this.db.prepare("SELECT * FROM account_watchlist WHERE account_id = ? ORDER BY added_at")
      .all(accountId).map((row) => ({
        alias: row.alias,
        candidateId: row.candidate_id,
        evidence: parse(row.evidence_json),
        security: parse(row.security_json),
        signalClose: row.signal_close,
        signalDate: row.signal_date,
        signalSource: row.signal_source,
        strategyId: row.strategy_id,
      }));
  }

  saveCandidateCalculation(calculation) {
    this.db.prepare(`INSERT INTO candidate_calculations
      (id, account_id, strategy_id, trading_date, status, result_count, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(calculation.id, calculation.accountId, calculation.strategyId, calculation.tradingDate,
        calculation.status, calculation.resultCount, json(calculation));
  }

  saveStrategyBuild(build) {
    this.db.prepare(`INSERT INTO strategy_builds
      (id, strategy_id, strategy_version, data_version, status, phase, completed, total, signal_count, failure_reason, algorithm_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status, phase=excluded.phase,
        completed=excluded.completed, total=excluded.total, signal_count=excluded.signal_count,
        failure_reason=excluded.failure_reason, algorithm_version=excluded.algorithm_version, updated_at=CURRENT_TIMESTAMP`)
      .run(build.id, build.strategyId, build.strategyVersion, build.dataVersion, build.status,
        build.phase, build.completed ?? 0, build.total ?? 0, build.signalCount ?? 0, build.failureReason ?? null,
        build.algorithmVersion ?? 1);
  }

  replaceStrategySignals(build, byDate) {
    this.db.prepare("DELETE FROM strategy_signals WHERE build_id = ?").run(build.id);
    const insert = this.db.prepare(`INSERT INTO strategy_signals
      (build_id, strategy_id, strategy_version, data_version, trading_date, security_key, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const [date, candidates] of byDate) {
      for (const candidate of candidates) insert.run(build.id, build.strategyId, build.strategyVersion,
        build.dataVersion, date, candidate.securityKey, json(candidate));
    }
  }

  latestStrategyBuild(strategyId) {
    const row = this.db.prepare("SELECT * FROM strategy_builds WHERE strategy_id = ? ORDER BY created_at DESC LIMIT 1").get(strategyId);
    return row ? { algorithmVersion: row.algorithm_version, completed: row.completed, dataVersion: row.data_version, failureReason: row.failure_reason,
      id: row.id, phase: row.phase, signalCount: row.signal_count, status: row.status,
      strategyId: row.strategy_id, strategyVersion: row.strategy_version, total: row.total } : null;
  }

  loadStrategySignals(buildId) {
    const rows = this.db.prepare("SELECT trading_date, payload_json FROM strategy_signals WHERE build_id = ? ORDER BY trading_date, security_key").all(buildId);
    const byDate = new Map();
    for (const row of rows) {
      if (!byDate.has(row.trading_date)) byDate.set(row.trading_date, []);
      byDate.get(row.trading_date).push(parse(row.payload_json));
    }
    return byDate;
  }
}

module.exports = {
  DEFAULT_DATABASE_PATH,
  SimulatorRepository,
  cents,
  json,
  parse,
};
