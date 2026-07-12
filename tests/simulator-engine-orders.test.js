"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { Account } = require("../src/simulator/core/account");
const { OrderApplicationService } = require("../src/simulator/application/orders");
const { CandidateAliasRegistry } = require("../src/simulator/selection/aliases");
const { SimulatorSession } = require("../src/simulator/core/session");
const { OrderSide, OrderStatus, SessionStatus } = require("../src/simulator/core/enums");

const DATES = ["2026-07-01", "2026-07-02", "2026-07-03"];
const SECURITIES = [{ code: "600001", market: 1 }, { code: "000002", market: 0 }];

function setup() {
  const aliases = new CandidateAliasRegistry({ salt: Buffer.alloc(32, 1) });
  const identities = aliases.register(SECURITIES);
  const account = new Account();
  const session = new SimulatorSession({ candidateSnapshot: {}, dates: DATES, startDate: DATES[0] });
  return { account, identities, service: new OrderApplicationService({ account, aliases, session }), session };
}

test("decision supports multiple securities and independent same-security orders", () => {
  const { account, identities, service } = setup();
  const first = service.create({ candidateId: identities[0].candidateId, estimatedFees: 5, estimatedPrice: 10, id: "a", quantity: 100, reason: "首次突破", side: OrderSide.BUY });
  const second = service.create({ candidateId: identities[0].candidateId, estimatedFees: 5, estimatedPrice: 10, id: "b", quantity: 200, reason: "分批建仓", side: OrderSide.BUY });
  const third = service.create({ candidateId: identities[1].candidateId, estimatedFees: 5, estimatedPrice: 20, id: "c", quantity: 100, reason: "另一候选", side: OrderSide.BUY });
  assert.deepEqual([first.status, second.status, third.status], [OrderStatus.ACCEPTED, OrderStatus.ACCEPTED, OrderStatus.ACCEPTED]);
  assert.deepEqual([first.reason, second.reason], ["首次突破", "分批建仓"]);
  assert.equal(account.frozenCash.size, 3);
  assert.equal(service.acceptedForDate(DATES[0]).length, 3);
});

test("orders require reasons and rejected reservations preserve the account", () => {
  const { account, identities, service } = setup();
  assert.throws(() => service.create({ candidateId: identities[0].candidateId, estimatedPrice: 10, quantity: 100, reason: "", side: OrderSide.BUY }), /reason/);
  const rejected = service.create({ candidateId: identities[0].candidateId, estimatedPrice: 2000, quantity: 100, reason: "资金不足测试", side: OrderSide.BUY });
  assert.equal(rejected.status, OrderStatus.REJECTED);
  assert.equal(rejected.rejectionReason, "insufficient_available_cash");
  assert.equal(account.snapshot().cash, 100000);
});

test("accepted orders can be revised and cancelled before decision completion", () => {
  const { account, identities, service } = setup();
  const order = service.create({ candidateId: identities[0].candidateId, estimatedFees: 5, estimatedPrice: 10, id: "edit", quantity: 100, reason: "初始理由", side: OrderSide.BUY });
  service.update(order.id, { quantity: 200, reason: "修改后的理由" });
  assert.equal(order.quantity, 200);
  assert.equal(order.reason, "修改后的理由");
  assert.equal(account.frozenCash.get(order.id), 2005);
  service.cancel(order.id);
  assert.equal(order.status, OrderStatus.CANCELLED);
  assert.equal(account.frozenCashTotal, 0);
});

test("completeDecision locks all order editing and returns the session to running", () => {
  const { identities, service, session } = setup();
  const order = service.create({ candidateId: identities[0].candidateId, estimatedPrice: 10, quantity: 100, reason: "锁定测试", side: OrderSide.BUY });
  service.completeDecision({ expectedVersion: 1 });
  assert.equal(session.status, SessionStatus.RUNNING);
  assert.throws(() => service.update(order.id, { reason: "不能修改" }), (error) => error.code === "decision_locked");
  assert.throws(() => service.cancel(order.id), (error) => error.code === "decision_locked");
});
