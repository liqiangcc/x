"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildServer } = require("../src/simulator/adapters/http/server");

function fakeRuntime() {
  const sessions = new Map();
  return {
    async createSession(input) {
      const value = { clock: { currentDate: input.startDate }, id: "session-1", status: "waiting_for_decision", version: 1 };
      sessions.set(value.id, value);
      return value;
    },
    getSession(id) {
      if (!sessions.has(id)) {
        const error = new Error("Session was not found.");
        error.code = "session_not_found";
        throw error;
      }
      return sessions.get(id);
    },
    completeDecision(id, { expectedVersion }) {
      const value = this.getSession(id);
      if (expectedVersion !== value.version) {
        const error = new Error("Session version does not match.");
        error.code = "session_version_conflict";
        throw error;
      }
      Object.assign(value, { status: "running", version: value.version + 1 });
      return value;
    },
    advance(id, { expectedVersion }) {
      const value = this.getSession(id);
      if (value.status !== "running") {
        const error = new Error("Session is not running.");
        error.code = "invalid_session_state";
        throw error;
      }
      if (expectedVersion !== value.version) {
        const error = new Error("Session version does not match.");
        error.code = "session_version_conflict";
        throw error;
      }
      Object.assign(value, { clock: { currentDate: "2026-07-02" }, status: "waiting_for_decision", version: value.version + 1 });
      return value;
    },
  };
}

test("session API creates, reads, completes and advances a versioned session", async (t) => {
  const app = buildServer({ runtime: fakeRuntime() });
  t.after(() => app.close());
  const created = await app.inject({ method: "POST", payload: { endDate: "2026-07-03", startDate: "2026-07-01" }, url: "/api/sessions" });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().status, "waiting_for_decision");
  const read = await app.inject({ method: "GET", url: "/api/sessions/session-1" });
  assert.equal(read.statusCode, 200);
  const completed = await app.inject({ method: "POST", payload: { expectedVersion: 1 }, url: "/api/sessions/session-1/complete-decision" });
  assert.equal(completed.json().status, "running");
  const advanced = await app.inject({ method: "POST", payload: { expectedVersion: 2 }, url: "/api/sessions/session-1/advance" });
  assert.equal(advanced.json().clock.currentDate, "2026-07-02");
  assert.equal(advanced.json().version, 3);
});

test("session API returns stable errors for conflicts, unknown resources and validation", async (t) => {
  const app = buildServer({ runtime: fakeRuntime() });
  t.after(() => app.close());
  await app.inject({ method: "POST", payload: { endDate: "2026-07-03", startDate: "2026-07-01" }, url: "/api/sessions" });
  const conflict = await app.inject({ method: "POST", payload: { expectedVersion: 9 }, url: "/api/sessions/session-1/complete-decision" });
  assert.equal(conflict.statusCode, 409);
  assert.deepEqual(conflict.json().error, { code: "session_version_conflict", issues: [], message: "Session version does not match." });
  const missing = await app.inject({ method: "GET", url: "/api/sessions/missing" });
  assert.equal(missing.statusCode, 404);
  const invalid = await app.inject({ method: "POST", payload: { startDate: "bad" }, url: "/api/sessions" });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error.code, "invalid_request");
});

test("session API returns structured 422 data-gate failures", async (t) => {
  const runtime = fakeRuntime();
  runtime.createSession = async () => {
    const error = new Error("Data is incomplete.");
    error.code = "data_gate_failed";
    error.statusCode = 422;
    error.issues = ["missing_available_universe"];
    throw error;
  };
  const app = buildServer({ runtime });
  t.after(() => app.close());
  const response = await app.inject({ method: "POST", payload: { endDate: "2026-07-03", startDate: "2026-07-01" }, url: "/api/sessions" });
  assert.equal(response.statusCode, 422);
  assert.deepEqual(response.json().error.issues, ["missing_available_universe"]);
});
