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
const { SessionMode } = require("../src/simulator/core/enums");
const { buildServer } = require("../src/simulator/adapters/http/server");

function runtimeEntry(mode = SessionMode.MANUAL) {
  const runtime = new SimulatorRuntimeService({
    selectionPipeline: { async select() { return { configHash: "hash", pagination: { items: [] }, qualityIssues: [] }; } },
  });
  const aliases = new CandidateAliasRegistry({ salt: Buffer.alloc(32, 9) });
  const [identity] = aliases.register([{ code: "600001", market: 1 }]);
  const session = new SimulatorSession({
    candidateSnapshot: { candidates: [{ ...identity, evidence: {}, qualityIssues: [], rank: 1 }] },
    dates: ["2026-07-01", "2026-07-02"],
    id: mode,
    mode,
    startDate: "2026-07-01",
  });
  const account = new Account();
  const orderService = new OrderApplicationService({ account, aliases, session });
  const entry = {
    account,
    aliases,
    config: {},
    dataVersion: "v1",
    engine: {
      fills: [],
      async finish({ expectedVersion }) { session.finish({ accountSnapshot: account.snapshot(), expectedVersion }); },
    },
    orderService,
    session,
  };
  runtime.entries.set(mode, entry);
  return runtime;
}

test("ordinary anonymous session reveals explicitly and records an event", async (t) => {
  const app = buildServer({ runtime: runtimeEntry() });
  t.after(() => app.close());
  const response = await app.inject({ method: "POST", payload: { expectedVersion: 1 }, url: "/api/sessions/manual/reveal" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().identities[0], { alias: "候选A", candidateId: response.json().identities[0].candidateId, code: "600001", market: 1 });
  const report = await app.inject({ method: "GET", url: "/api/sessions/manual/report" });
  assert.equal(report.json().events.at(-1).type, "IdentityRevealed");
});

test("blind session refuses reveal until completion", async (t) => {
  const runtime = runtimeEntry(SessionMode.BLIND);
  const app = buildServer({ runtime });
  t.after(() => app.close());
  const locked = await app.inject({ method: "POST", payload: { expectedVersion: 1 }, url: "/api/sessions/blind/reveal" });
  assert.equal(locked.statusCode, 409);
  assert.equal(locked.json().error.code, "blind_reveal_locked");
  const finished = await app.inject({ method: "POST", payload: { expectedVersion: 1 }, url: "/api/sessions/blind/finish" });
  assert.equal(finished.json().status, "completed");
  const revealed = await app.inject({ method: "POST", payload: { expectedVersion: 2 }, url: "/api/sessions/blind/reveal" });
  assert.equal(revealed.statusCode, 200);
});

test("report stays anonymous before reveal and export uses atomic final JSON", async (t) => {
  const runtime = runtimeEntry();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "x-simulator-export-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const report = await runtime.getReport("manual");
  assert.deepEqual(report.identities, []);
  const exported = await runtime.exportSession("manual", { exportRoot: root });
  const payload = JSON.parse(await fs.readFile(exported.filePath, "utf8"));
  assert.deepEqual(payload.identities, []);
  assert.deepEqual((await fs.readdir(root)).filter((name) => name.endsWith(".tmp")), []);
});
