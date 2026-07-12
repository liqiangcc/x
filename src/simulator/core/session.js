"use strict";

const { randomUUID } = require("node:crypto");
const { EventType, SessionMode, SessionStatus } = require("./enums");
const { MarketClock } = require("./market_clock");

function sessionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

class SimulatorSession {
  constructor({
    candidateSnapshot,
    dates,
    id = randomUUID(),
    mode = SessionMode.MANUAL,
    startDate,
  }) {
    if (!candidateSnapshot) throw new TypeError("candidateSnapshot is required at session creation.");
    this.id = id;
    this.mode = mode;
    this.clock = new MarketClock({ currentDate: startDate, dates });
    this.status = SessionStatus.WAITING_FOR_DECISION;
    this.version = 1;
    this.candidateSnapshot = candidateSnapshot;
    this.events = [
      this.#event(EventType.SESSION_CREATED, { mode, startDate: this.clock.currentDate }),
      this.#event(EventType.CANDIDATE_SNAPSHOT_CREATED, { date: this.clock.currentDate }),
      this.#event(EventType.DECISION_REQUESTED, { date: this.clock.currentDate }),
    ];
  }

  #event(type, payload) {
    return Object.freeze({ payload: Object.freeze({ ...payload }), type, version: this.version });
  }

  #assertStatus(expected, operation) {
    if (this.status !== expected) {
      throw sessionError("invalid_session_state", `${operation} requires ${expected}; current state is ${this.status}.`);
    }
  }

  assertVersion(expectedVersion) {
    if (expectedVersion !== this.version) {
      throw sessionError("session_version_conflict", `Expected session version ${expectedVersion}; current version is ${this.version}.`);
    }
  }

  completeDecision({ expectedVersion = this.version } = {}) {
    this.assertVersion(expectedVersion);
    this.#assertStatus(SessionStatus.WAITING_FOR_DECISION, "completeDecision");
    this.version += 1;
    this.status = SessionStatus.RUNNING;
    this.events.push(this.#event(EventType.DECISION_COMPLETED, { date: this.clock.currentDate }));
    return this.snapshot();
  }

  advance({ candidateSnapshot, expectedVersion = this.version } = {}) {
    this.assertVersion(expectedVersion);
    this.#assertStatus(SessionStatus.RUNNING, "advance");
    if (!candidateSnapshot) throw new TypeError("candidateSnapshot is required for the next close.");
    const previousDate = this.clock.currentDate;
    const date = this.clock.advance();
    this.version += 1;
    this.status = SessionStatus.WAITING_FOR_DECISION;
    this.candidateSnapshot = candidateSnapshot;
    this.events.push(
      this.#event(EventType.MARKET_ADVANCED, { date, previousDate }),
      this.#event(EventType.MARKET_CLOSED, { date }),
      this.#event(EventType.CANDIDATE_SNAPSHOT_CREATED, { date }),
      this.#event(EventType.DECISION_REQUESTED, { date }),
    );
    return this.snapshot();
  }

  finish({ accountSnapshot, expectedVersion = this.version } = {}) {
    this.assertVersion(expectedVersion);
    if (![SessionStatus.WAITING_FOR_DECISION, SessionStatus.RUNNING].includes(this.status)) {
      throw sessionError("invalid_session_state", `finish is not allowed from ${this.status}.`);
    }
    this.version += 1;
    this.status = SessionStatus.COMPLETED;
    this.finalAccountSnapshot = accountSnapshot;
    this.events.push(this.#event(EventType.SESSION_COMPLETED, { date: this.clock.currentDate }));
    return this.snapshot();
  }

  snapshot() {
    return Object.freeze({
      candidateSnapshot: this.candidateSnapshot,
      clock: Object.freeze(this.clock.snapshot()),
      id: this.id,
      finalAccountSnapshot: this.finalAccountSnapshot ?? null,
      mode: this.mode,
      status: this.status,
      version: this.version,
    });
  }
}

module.exports = {
  SimulatorSession,
  sessionError,
};
