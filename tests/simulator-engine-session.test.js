"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { MarketClock } = require("../src/simulator/core/market_clock");
const { SimulatorSession } = require("../src/simulator/core/session");
const { EventType, SessionStatus } = require("../src/simulator/core/enums");

const DATES = ["2026-06-30", "2026-07-01", "2026-07-02"];

test("MarketClock advances only over its deterministic trading calendar", () => {
  const clock = new MarketClock({ currentDate: "20260701", dates: DATES });
  assert.deepEqual(clock.snapshot(), { currentDate: "2026-07-01", nextDate: "2026-07-02" });
  assert.equal(clock.advance(), "2026-07-02");
  assert.throws(() => clock.advance(), (error) => error.code === "end_of_calendar");
  assert.throws(() => new MarketClock({ currentDate: "2026-07-03", dates: DATES }), /not a trading date/);
});

test("session creation immediately pauses at D close with a candidate snapshot", () => {
  const candidateSnapshot = Object.freeze({ candidates: ["cand_a"], date: "2026-07-01" });
  const session = new SimulatorSession({ candidateSnapshot, dates: DATES, id: "session-1", startDate: "2026-07-01" });
  assert.equal(session.status, SessionStatus.WAITING_FOR_DECISION);
  assert.equal(session.version, 1);
  assert.equal(session.candidateSnapshot, candidateSnapshot);
  assert.deepEqual(session.events.map((event) => event.type), [
    EventType.SESSION_CREATED,
    EventType.CANDIDATE_SNAPSHOT_CREATED,
    EventType.DECISION_REQUESTED,
  ]);
});

test("session follows waiting -> running -> next close waiting transitions", () => {
  const session = new SimulatorSession({ candidateSnapshot: { date: "2026-07-01" }, dates: DATES, startDate: "2026-07-01" });
  session.completeDecision({ expectedVersion: 1 });
  assert.equal(session.status, SessionStatus.RUNNING);
  const snapshot = session.advance({ candidateSnapshot: { date: "2026-07-02" }, expectedVersion: 2 });
  assert.equal(snapshot.status, SessionStatus.WAITING_FOR_DECISION);
  assert.equal(snapshot.clock.currentDate, "2026-07-02");
  assert.equal(snapshot.version, 3);
});

test("session rejects duplicate, illegal and stale mutations", () => {
  const session = new SimulatorSession({ candidateSnapshot: {}, dates: DATES, startDate: "2026-07-01" });
  assert.throws(() => session.advance({ candidateSnapshot: {} }), (error) => error.code === "invalid_session_state");
  assert.throws(() => session.completeDecision({ expectedVersion: 0 }), (error) => error.code === "session_version_conflict");
  session.completeDecision();
  assert.throws(() => session.completeDecision(), (error) => error.code === "invalid_session_state");
  session.advance({ candidateSnapshot: {} });
  assert.throws(() => session.advance({ candidateSnapshot: {} }), (error) => error.code === "invalid_session_state");
});
