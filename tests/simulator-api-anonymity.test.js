"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { Account } = require("../src/simulator/core/account");
const { SimulatorRuntimeService } = require("../src/simulator/application/runtime_service");
const { CandidateAliasRegistry } = require("../src/simulator/selection/aliases");
const { OrderApplicationService } = require("../src/simulator/application/orders");
const { SimulatorSession } = require("../src/simulator/core/session");
const { buildServer, errorBody } = require("../src/simulator/adapters/http/server");

const SECURITY = { code: "600001", market: 1 };
const SECRET_TOKENS = ["600001", "1.600001", "真实名称", '"market":', '"security":'];

function assertAnonymous(value) {
  const output = typeof value === "string" ? value : JSON.stringify(value);
  for (const token of SECRET_TOKENS) assert.equal(output.includes(token), false, `leaked ${token}`);
}

function makeRuntime(saltByte, id) {
  const runtime = new SimulatorRuntimeService({
    selectionPipeline: { async select() { return { configHash: "hash", pagination: { items: [] }, qualityIssues: [] }; } },
  });
  const aliases = new CandidateAliasRegistry({ salt: Buffer.alloc(32, saltByte) });
  const [identity] = aliases.register([SECURITY]);
  const candidateSnapshot = {
    candidates: [{ ...identity, evidence: { breakout_margin_pct: 1.2 }, qualityIssues: [], rank: 1 }],
    dataMode: "legacy_approximate",
  };
  const session = new SimulatorSession({ candidateSnapshot, dates: ["2026-07-01", "2026-07-02"], id, startDate: "2026-07-01" });
  const account = new Account();
  account.freezeBuy({ amount: 1005, orderId: "seed" });
  account.settleBuy({ availableDate: "2026-07-02", fees: 5, orderId: "seed", quantity: 100, security: SECURITY, totalCost: 1005 });
  const orderService = new OrderApplicationService({ account, aliases, session });
  const order = orderService.create({ candidateId: identity.candidateId, estimatedFees: 5, estimatedPrice: 10, id: "order-safe", quantity: 100, reason: "突破练习", side: "buy" });
  const entry = { account, aliases, config: { calendarSecurities: [SECURITY], selection: {} }, dataVersion: "v1", engine: { fills: [] }, orderService, session };
  runtime.entries.set(id, entry);
  return { identity, order, runtime };
}

test("session, candidates, portfolio, orders, fills and events use anonymous whitelists", async (t) => {
  const { identity, runtime } = makeRuntime(11, "audit");
  const app = buildServer({ runtime });
  t.after(() => app.close());
  const responses = await Promise.all([
    app.inject({ method: "GET", url: "/api/sessions/audit" }),
    app.inject({ method: "GET", url: "/api/sessions/audit/candidates" }),
    app.inject({ method: "GET", url: "/api/sessions/audit/portfolio" }),
    app.inject({ method: "GET", url: "/api/sessions/audit/report" }),
  ]);
  for (const response of responses) {
    assert.equal(response.statusCode, 200);
    assertAnonymous(response.body);
  }
  assert.equal(responses[0].json().candidateSnapshot.candidates[0].candidateId, identity.candidateId);
});

test("anonymous export and errors do not disclose nested source identity", async (t) => {
  const { runtime } = makeRuntime(12, "export-audit");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "x-anonymous-export-"));
  t.after(() => fs.rm(root, { force: true, recursive: true }));
  const result = await runtime.exportSession("export-audit", { exportRoot: root });
  assertAnonymous(await fs.readFile(result.filePath, "utf8"));
  assertAnonymous(errorBody(Object.assign(new Error("Candidate was not found in this session."), { code: "unknown_candidate" })));
});

test("independent sessions cannot correlate candidate IDs or aliases", () => {
  const first = makeRuntime(13, "first");
  const second = makeRuntime(14, "second");
  assert.notEqual(first.identity.candidateId, second.identity.candidateId);
  const firstCandidate = first.runtime.getCandidates("first", { viewAll: true }).pagination.items[0];
  const secondCandidate = second.runtime.getCandidates("second", { viewAll: true }).pagination.items[0];
  assert.notDeepEqual(
    { alias: firstCandidate.alias, candidateId: firstCandidate.candidateId },
    { alias: secondCandidate.alias, candidateId: secondCandidate.candidateId },
  );
});
