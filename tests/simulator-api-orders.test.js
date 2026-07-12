"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildServer } = require("../src/simulator/adapters/http/server");

function runtime() {
  return {
    createOrder(_sessionId, input) { return { order: { ...input, id: "order-1", status: "accepted" }, sessionVersion: input.expectedVersion + 1 }; },
    updateOrder(_sessionId, orderId, input) { return { order: { ...input, id: orderId, status: "accepted" }, sessionVersion: input.expectedVersion + 1 }; },
    cancelOrder(_sessionId, orderId, input) { return { order: { id: orderId, status: "cancelled" }, sessionVersion: input.expectedVersion + 1 }; },
    getCandidates(_sessionId, options) { return { dataMode: "legacy_approximate", pagination: { items: [{ alias: "候选A", candidateId: "cand_a" }], ...options, total: 1 } }; },
    getChart(_sessionId, candidateId) { return { alias: "候选A", candidateId, daily: [{ close: 10, date: "2026-07-01" }], yearly: [] }; },
    getPortfolio() { return { cash: 100000, positions: [] }; },
  };
}

test("order API creates, updates and cancels anonymous candidate orders", async (t) => {
  const app = buildServer({ runtime: runtime() });
  t.after(() => app.close());
  const created = await app.inject({ method: "POST", payload: { candidateId: "cand_a", estimatedPrice: 10, expectedVersion: 1, quantity: 100, reason: "突破", side: "buy" }, url: "/api/sessions/s/orders" });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().order.status, "accepted");
  const updated = await app.inject({ method: "PATCH", payload: { expectedVersion: 2, quantity: 200, reason: "加仓" }, url: "/api/sessions/s/orders/order-1" });
  assert.equal(updated.json().order.quantity, 200);
  const cancelled = await app.inject({ method: "DELETE", payload: { expectedVersion: 3 }, url: "/api/sessions/s/orders/order-1" });
  assert.equal(cancelled.json().order.status, "cancelled");
});

test("query API returns candidates, chart and portfolio without requiring a real code", async (t) => {
  const app = buildServer({ runtime: runtime() });
  t.after(() => app.close());
  const candidates = await app.inject({ method: "GET", url: "/api/sessions/s/candidates?pageSize=20" });
  assert.equal(candidates.json().pagination.items[0].candidateId, "cand_a");
  const chart = await app.inject({ method: "GET", url: "/api/sessions/s/chart/cand_a" });
  assert.equal(chart.json().daily[0].close, 10);
  const portfolio = await app.inject({ method: "GET", url: "/api/sessions/s/portfolio" });
  assert.equal(portfolio.json().cash, 100000);
});

test("order API validates parameters and maps unknown resources", async (t) => {
  const service = runtime();
  service.createOrder = () => {
    const error = new Error("Unknown candidateId for this session.");
    error.code = "unknown_candidate";
    throw error;
  };
  const app = buildServer({ runtime: service });
  t.after(() => app.close());
  const invalid = await app.inject({ method: "POST", payload: { candidateId: "cand_a", expectedVersion: 1, quantity: 0, reason: "x", side: "buy" }, url: "/api/sessions/s/orders" });
  assert.equal(invalid.statusCode, 400);
  const missing = await app.inject({ method: "POST", payload: { candidateId: "cand_x", estimatedPrice: 10, expectedVersion: 1, quantity: 100, reason: "x", side: "buy" }, url: "/api/sessions/s/orders" });
  assert.equal(missing.statusCode, 404);
});
