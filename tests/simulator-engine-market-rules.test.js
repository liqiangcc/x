"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { Account } = require("../src/simulator/core/account");
const { OrderApplicationService } = require("../src/simulator/application/orders");
const { TradingSessionEngine } = require("../src/simulator/application/sessions");
const { CandidateAliasRegistry } = require("../src/simulator/selection/aliases");
const { SimulatorSession } = require("../src/simulator/core/session");
const { OrderSide, OrderStatus, SessionStatus } = require("../src/simulator/core/enums");

const DATES = ["2026-07-01", "2026-07-02", "2026-07-03"];
const SECURITIES = [
  { code: "600001", market: 1 },
  { code: "600002", market: 1 },
  { code: "600003", market: 1 },
];

function setup(bars) {
  const aliases = new CandidateAliasRegistry({ salt: Buffer.alloc(32, 3) });
  const identities = aliases.register(SECURITIES);
  const account = new Account();
  const session = new SimulatorSession({ candidateSnapshot: { date: DATES[0] }, dates: DATES, startDate: DATES[0] });
  const orderService = new OrderApplicationService({ account, aliases, session });
  const klineRepository = {
    async getLegacyBar({ code, date }) {
      const bar = bars[`${code}:${date}`] ?? null;
      return { bar };
    },
  };
  const engine = new TradingSessionEngine({
    account,
    candidateSnapshotFactory: async (date) => ({ date }),
    executionConfig: { commissionRate: 0.0003, minimumCommissionYuan: 5, slippageRate: 0.001, stampDutyRate: 0.0005 },
    klineRepository,
    orderService,
    session,
  });
  return { account, engine, identities, orderService, session };
}

test("next-open engine fills tradable orders and expires suspended or limit-up buys", async () => {
  const bars = {
    "600001:2026-07-02": { close: 10.2, date: "2026-07-02", high: 10.3, low: 9.9, open: 10, volume: 1000 },
    "600002:2026-07-02": { close: null, date: "2026-07-02", high: null, low: null, open: null, suspended: true, volume: 0 },
    "600003:2026-07-02": { close: 11, date: "2026-07-02", high: 11, limitUp: true, low: 11, open: 11, volume: 100 },
  };
  const { account, engine, identities, orderService, session } = setup(bars);
  const orders = identities.map((identity, index) => orderService.create({
    candidateId: identity.candidateId,
    estimatedFees: 100,
    estimatedPrice: 11,
    id: `order-${index}`,
    quantity: 100,
    reason: "规则测试",
    side: OrderSide.BUY,
  }));
  orderService.completeDecision();
  await engine.advance();
  assert.deepEqual(orders.map((order) => order.status), [OrderStatus.FILLED, OrderStatus.EXPIRED, OrderStatus.EXPIRED]);
  assert.equal(orders[1].rejectionReason, "suspended_or_missing_open");
  assert.equal(orders[2].rejectionReason, "buy_at_limit_up_open");
  assert.equal(account.position(SECURITIES[0]).availableQuantity, 0);
  assert.equal(account.frozenCashTotal, 0);
  assert.equal(session.status, SessionStatus.WAITING_FOR_DECISION);
});

test("limit-down sells expire and release frozen shares", async () => {
  const bars = {
    "600001:2026-07-02": { close: 9, date: "2026-07-02", high: 9, limitDown: true, low: 9, open: 9, volume: 100 },
  };
  const { account, engine, identities, orderService } = setup(bars);
  account.freezeBuy({ amount: 1005, orderId: "seed" });
  account.settleBuy({ availableDate: "2026-07-01", fees: 5, orderId: "seed", quantity: 100, security: SECURITIES[0], totalCost: 1005 });
  account.openTradingDate("2026-07-01");
  const sell = orderService.create({ candidateId: identities[0].candidateId, id: "sell", quantity: 100, reason: "止损", side: OrderSide.SELL });
  orderService.completeDecision();
  await engine.advance();
  assert.equal(sell.status, OrderStatus.EXPIRED);
  assert.equal(account.position(SECURITIES[0]).availableQuantity, 100);
});

test("finish cancels pending orders and values holdings at the last real close without liquidation", async () => {
  const bars = {
    "600001:2026-07-01": { close: 12, date: "2026-07-01", high: 12.1, low: 11.9, open: 12, volume: 100 },
  };
  const { account, engine, identities, orderService, session } = setup(bars);
  account.freezeBuy({ amount: 1005, orderId: "seed" });
  account.settleBuy({ availableDate: "2026-07-01", fees: 5, orderId: "seed", quantity: 100, security: SECURITIES[0], totalCost: 1005 });
  account.openTradingDate("2026-07-01");
  const pending = orderService.create({ candidateId: identities[1].candidateId, estimatedPrice: 10, id: "pending", quantity: 100, reason: "未推进", side: OrderSide.BUY });
  const result = await engine.finish();
  assert.equal(pending.status, OrderStatus.CANCELLED);
  assert.equal(result.status, SessionStatus.COMPLETED);
  assert.equal(result.finalAccountSnapshot.positions[0].quantity, 100);
  assert.equal(result.finalAccountSnapshot.marketValue, 1200);
  assert.equal(session.events.at(-1).type, "SessionCompleted");
});
