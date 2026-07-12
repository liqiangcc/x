"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { Account } = require("../src/simulator/core/account");
const { SimulatorRuntimeService } = require("../src/simulator/application/runtime_service");
const { CandidateAliasRegistry } = require("../src/simulator/selection/aliases");
const { OrderApplicationService } = require("../src/simulator/application/orders");
const { SimulatorSession } = require("../src/simulator/core/session");
const { buildServer } = require("../src/simulator/adapters/http/server");

function runtimeWithParent() {
  const runtime = new SimulatorRuntimeService({
    selectionPipeline: { async select() { return { configHash: "hash", pagination: { items: [] }, qualityIssues: [] }; } },
  });
  const aliases = new CandidateAliasRegistry({ salt: Buffer.alloc(32, 7) });
  const [identity] = aliases.register([{ code: "600001", market: 1 }]);
  const session = new SimulatorSession({
    candidateSnapshot: { candidates: [{ ...identity, evidence: { breakout_margin_pct: 1 }, qualityIssues: [], rank: 1 }], dataVersion: "v1" },
    dates: ["2026-07-01", "2026-07-02", "2026-07-03"],
    id: "parent",
    startDate: "2026-07-01",
  });
  const account = new Account();
  account.freezeBuy({ amount: 1005, orderId: "seed" });
  account.settleBuy({ availableDate: "2026-07-02", fees: 5, orderId: "seed", quantity: 100, security: { code: "600001", market: 1 }, totalCost: 1005 });
  const orderService = new OrderApplicationService({ account, aliases, session });
  runtime.entries.set("parent", { account, aliases, config: { selection: { old: true } }, dataVersion: "v1", orderService, session });
  return runtime;
}

test("clone API creates a child with copied assets, history reference and new aliases", async (t) => {
  const runtime = runtimeWithParent();
  const parentBefore = runtime.getSession("parent");
  const app = buildServer({ runtime });
  t.after(() => app.close());
  const response = await app.inject({
    method: "POST",
    payload: { expectedVersion: 1, selection: { strategy: { type: "custom" } } },
    url: "/api/sessions/parent/clone",
  });
  assert.equal(response.statusCode, 201);
  const child = response.json();
  assert.notEqual(child.id, "parent");
  assert.equal(child.lineage.parentSessionId, "parent");
  assert.equal(child.lineage.branchDate, "2026-07-01");
  assert.equal(child.selectionEffectiveDate, "2026-07-02");
  assert.equal(child.account.positions[0].quantity, 100);
  assert.notEqual(child.candidateSnapshot.candidates[0].candidateId, parentBefore.candidateSnapshot.candidates[0].candidateId);
  assert.deepEqual(runtime.getSession("parent"), parentBefore);
});

test("clone API enforces the parent session version", async (t) => {
  const app = buildServer({ runtime: runtimeWithParent() });
  t.after(() => app.close());
  const response = await app.inject({ method: "POST", payload: { expectedVersion: 9, selection: {} }, url: "/api/sessions/parent/clone" });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error.code, "session_version_conflict");
});
