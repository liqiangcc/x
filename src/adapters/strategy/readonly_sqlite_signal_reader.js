"use strict";

const path = require("node:path");
const Database = require("better-sqlite3");
const { normalizeDate } = require("../../core/date");

const DEFAULT_SIGNAL_DATABASE_PATH = path.join("var", "simulator", "simulator.db");

function signalStoreError(code, message, cause = null) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function isoDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = normalizeDate(value);
  return `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`;
}

function normalizeStrategyId(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > 128) {
    throw new TypeError("strategyId must be a non-empty string up to 128 characters.");
  }
  return normalized;
}

function normalizeSecurityKey(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > 160) {
    throw new TypeError("securityKey must be a non-empty string up to 160 characters.");
  }
  return normalized;
}

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

function parseCandidate(row, rank) {
  let payload;
  try {
    payload = JSON.parse(row.payload_json);
  } catch (error) {
    throw signalStoreError("signal_store_invalid_payload", "Strategy signal store contains invalid candidate JSON.", error);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw signalStoreError("signal_store_invalid_payload", "Strategy signal store contains an invalid candidate payload.");
  }
  return {
    ...payload,
    securityKey: payload.securityKey ?? row.security_key,
    rank,
  };
}

function buildPayload(build) {
  if (!build) return null;
  return {
    id: build.id,
    strategyVersion: build.strategy_version,
    dataVersion: build.data_version,
    algorithmVersion: build.algorithm_version,
    status: build.status,
    signalCount: build.signal_count,
  };
}

function sourcePayload() {
  return { kind: "simulator_strategy_signal_store", readonly: true };
}

function latestReadyBuild(db, strategyId) {
  return db.prepare(`SELECT id, strategy_id, strategy_version, data_version, status,
      algorithm_version, signal_count, created_at
    FROM strategy_builds
    WHERE strategy_id = ? AND status = 'ready'
    ORDER BY created_at DESC, rowid DESC
    LIMIT 1`).get(strategyId) ?? null;
}

function pagePayload({ offset, limit, returned, total }) {
  const nextOffset = offset + returned;
  return {
    offset,
    limit,
    returned,
    total,
    hasMore: nextOffset < total,
    nextOffset: nextOffset < total ? nextOffset : null,
  };
}

class ReadonlySqliteSignalReader {
  constructor({
    databasePath = DEFAULT_SIGNAL_DATABASE_PATH,
    DatabaseImpl = Database,
  } = {}) {
    if (typeof DatabaseImpl !== "function") throw new TypeError("DatabaseImpl must be a constructor.");
    this.databasePath = path.resolve(databasePath);
    this.DatabaseImpl = DatabaseImpl;
  }

  open() {
    try {
      const db = new this.DatabaseImpl(this.databasePath, {
        readonly: true,
        fileMustExist: true,
      });
      db.pragma("query_only = ON");
      return db;
    } catch (error) {
      throw signalStoreError("signal_store_unavailable", "Strategy signal store is unavailable.", error);
    }
  }

  async getStrategyCandidates({
    strategyId,
    date = null,
    limit = 50,
    offset = 0,
  } = {}) {
    const normalizedStrategyId = normalizeStrategyId(strategyId);
    const normalizedDate = isoDate(date);
    const normalizedLimit = normalizeLimit(limit);
    const normalizedOffset = normalizeOffset(offset);
    const db = this.open();

    try {
      const build = latestReadyBuild(db, normalizedStrategyId);
      if (!build) {
        return {
          status: "not_built",
          strategyId: normalizedStrategyId,
          date: normalizedDate,
          build: null,
          candidates: [],
          page: pagePayload({ offset: normalizedOffset, limit: normalizedLimit, returned: 0, total: 0 }),
          source: sourcePayload(),
        };
      }

      const targetDate = normalizedDate ?? db.prepare(
        "SELECT MAX(trading_date) AS trading_date FROM strategy_signals WHERE build_id = ?"
      ).get(build.id)?.trading_date ?? null;

      if (!targetDate) {
        return {
          status: "ready",
          strategyId: normalizedStrategyId,
          date: null,
          build: buildPayload(build),
          candidates: [],
          page: pagePayload({ offset: normalizedOffset, limit: normalizedLimit, returned: 0, total: 0 }),
          source: sourcePayload(),
        };
      }

      const total = db.prepare(
        "SELECT COUNT(*) AS count FROM strategy_signals WHERE build_id = ? AND trading_date = ?"
      ).get(build.id, targetDate).count;
      const rows = db.prepare(`SELECT security_key, payload_json
        FROM strategy_signals
        WHERE build_id = ? AND trading_date = ?
        ORDER BY rowid
        LIMIT ? OFFSET ?`).all(build.id, targetDate, normalizedLimit, normalizedOffset);
      const candidates = rows.map((row, index) => parseCandidate(row, normalizedOffset + index + 1));

      return {
        status: "ready",
        strategyId: normalizedStrategyId,
        date: targetDate,
        build: buildPayload(build),
        candidates,
        page: pagePayload({
          offset: normalizedOffset,
          limit: normalizedLimit,
          returned: candidates.length,
          total,
        }),
        source: sourcePayload(),
      };
    } catch (error) {
      if (error?.code?.startsWith?.("signal_store_")) throw error;
      throw signalStoreError("signal_store_incompatible", "Strategy signal store schema is incompatible with this reader.", error);
    } finally {
      db.close();
    }
  }

  async getStrategySignal({ strategyId, date, securityKey } = {}) {
    const normalizedStrategyId = normalizeStrategyId(strategyId);
    const normalizedDate = isoDate(date);
    if (!normalizedDate) throw new TypeError("date is required.");
    const normalizedSecurityKey = normalizeSecurityKey(securityKey);
    const db = this.open();

    try {
      const build = latestReadyBuild(db, normalizedStrategyId);
      if (!build) {
        return {
          status: "not_built",
          strategyId: normalizedStrategyId,
          date: normalizedDate,
          securityKey: normalizedSecurityKey,
          build: null,
          candidate: null,
          source: sourcePayload(),
        };
      }

      const row = db.prepare(`SELECT s.security_key, s.payload_json,
          (SELECT COUNT(*)
             FROM strategy_signals ranked
            WHERE ranked.build_id = s.build_id
              AND ranked.trading_date = s.trading_date
              AND ranked.rowid <= s.rowid) AS signal_rank
        FROM strategy_signals s
        WHERE s.build_id = ? AND s.trading_date = ? AND s.security_key = ?
        LIMIT 1`).get(build.id, normalizedDate, normalizedSecurityKey);

      if (!row) {
        return {
          status: "not_found",
          strategyId: normalizedStrategyId,
          date: normalizedDate,
          securityKey: normalizedSecurityKey,
          build: buildPayload(build),
          candidate: null,
          source: sourcePayload(),
        };
      }

      return {
        status: "ready",
        strategyId: normalizedStrategyId,
        date: normalizedDate,
        securityKey: normalizedSecurityKey,
        build: buildPayload(build),
        candidate: parseCandidate(row, Number(row.signal_rank)),
        source: sourcePayload(),
      };
    } catch (error) {
      if (error?.code?.startsWith?.("signal_store_")) throw error;
      throw signalStoreError("signal_store_incompatible", "Strategy signal store schema is incompatible with this reader.", error);
    } finally {
      db.close();
    }
  }
}

module.exports = {
  DEFAULT_SIGNAL_DATABASE_PATH,
  ReadonlySqliteSignalReader,
  buildPayload,
  isoDate,
  latestReadyBuild,
  normalizeLimit,
  normalizeOffset,
  normalizeSecurityKey,
  normalizeStrategyId,
  pagePayload,
  parseCandidate,
  signalStoreError,
  sourcePayload,
};
