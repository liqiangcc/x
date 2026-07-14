"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { CandidateAliasRegistry, aliasSuffix } = require("../src/simulator/selection/aliases");
const { candidateDto, chartDto, holdingDto } = require("../src/simulator/selection/candidate_dto");

const SECURITIES = [
  { code: "600001", market: 1 },
  { code: "000002", market: 0 },
];

function serialized(value) {
  return JSON.stringify(value);
}

function assertNoIdentityLeak(value) {
  const output = serialized(value);
  for (const token of ["600001", "000002", "真实名称", "securityKey", '"code"', '"market"', "1.600001", "0.000002"]) {
    assert.equal(output.includes(token), false, `leaked token: ${token}`);
  }
}

test("candidate aliases stay stable while carrying real display identity", () => {
  const first = new CandidateAliasRegistry({ salt: Buffer.alloc(32, 1) });
  const second = new CandidateAliasRegistry({ salt: Buffer.alloc(32, 2) });
  const firstView = first.register(SECURITIES);
  assert.deepEqual(first.register(SECURITIES), firstView);
  const secondView = second.register(SECURITIES);
  assert.notDeepEqual(secondView.map((item) => item.candidateId), firstView.map((item) => item.candidateId));
  assert.deepEqual(first.resolve(firstView[0].candidateId), SECURITIES[0]);
  assert.equal(second.resolve(firstView[0].candidateId), null);
  assert.deepEqual(firstView[0].security, SECURITIES[0]);
});

test("candidate aliases scale beyond one alphabet", () => {
  assert.equal(aliasSuffix(0), "A");
  assert.equal(aliasSuffix(25), "Z");
  assert.equal(aliasSuffix(26), "AA");
});

test("candidate DTO sanitizes evidence and carries the registered display identity", () => {
  const identity = { alias: "候选A", candidateId: "cand_safe", security: { code: "600001", market: 1, name: "真实名称" } };
  const dto = candidateDto({
    code: "600001",
    market: 1,
    name: "真实名称",
    securityKey: "1.600001",
    rank: 1,
    evidence: {
      annual_points: [{ close: 14, high: 17, year: 2025, code: "600001" }],
      breakout_margin_pct: 1.2,
      today_change_pct: 2.5,
      code: "600001",
    },
  }, identity);
  assert.deepEqual(Object.keys(dto), ["alias", "candidateId", "evidence", "qualityIssues", "rank", "security"]);
  assert.deepEqual(dto.security, identity.security);
  assert.equal(JSON.stringify(dto.evidence).includes("600001"), false);
  assert.equal(dto.evidence.today_change_pct, 2.5);
});

test("chart and holding DTOs expose only anonymous whitelisted fields", () => {
  const identity = { alias: "候选B", candidateId: "cand_safe" };
  const chart = chartDto({
    ...identity,
    code: "600001",
    daily: [{ close: 17.2, code: "600001", date: "2026-07-01", market: 1 }],
    yearly: [{ close: 14, name: "真实名称", year: 2025 }],
  });
  const holding = holdingDto({
    availableQuantity: 100,
    averageCost: 17.3,
    code: "600001",
    marketValue: 1720,
    name: "真实名称",
    quantity: 100,
    unrealizedPnl: -10,
  }, identity);
  assertNoIdentityLeak(chart);
  assertNoIdentityLeak(holding);
});
