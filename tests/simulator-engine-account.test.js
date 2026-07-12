"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { Account } = require("../src/simulator/core/account");

const SECURITY = { code: "600001", market: 1 };
const KEY = "1.600001";

test("account starts with 100,000 yuan and conserves frozen buy cash", () => {
  const account = new Account();
  account.freezeBuy({ amount: 1735, orderId: "buy-1" });
  assert.deepEqual(account.snapshot(), {
    cash: 100000,
    cashAvailable: 98265,
    equity: 100000,
    frozenCash: 1735,
    marketValue: 0,
    positions: [],
    realizedPnl: 0,
    totalFees: 0,
    unrealizedPnl: 0,
  });
  account.releaseOrder("buy-1");
  assert.equal(account.cashAvailable, 100000);
});

test("buy fill releases excess cash and keeps shares unavailable until T+1", () => {
  const account = new Account();
  account.freezeBuy({ amount: 1740, orderId: "buy-1" });
  account.settleBuy({
    availableDate: "2026-07-03",
    fees: 5,
    orderId: "buy-1",
    quantity: 100,
    security: SECURITY,
    totalCost: 1735,
  });
  const position = account.position(SECURITY);
  assert.equal(position.quantity, 100);
  assert.equal(position.availableQuantity, 0);
  assert.equal(account.cashAvailable, 98265);
  account.openTradingDate("2026-07-02");
  assert.equal(position.availableQuantity, 0);
  account.openTradingDate("2026-07-03");
  assert.equal(position.availableQuantity, 100);
  assert.equal(account.snapshot({ prices: { [KEY]: 18 } }).equity, 100065);
});

test("sell freeze, cancellation and fill conserve shares and calculate PnL", () => {
  const account = new Account();
  account.freezeBuy({ amount: 1005, orderId: "buy-1" });
  account.settleBuy({ availableDate: "2026-07-02", fees: 5, orderId: "buy-1", quantity: 100, security: SECURITY, totalCost: 1005 });
  account.openTradingDate("2026-07-02");
  account.freezeSell({ orderId: "sell-cancel", quantity: 100, security: SECURITY });
  assert.equal(account.position(SECURITY).availableQuantity, 0);
  account.releaseOrder("sell-cancel");
  assert.equal(account.position(SECURITY).availableQuantity, 100);
  account.freezeSell({ orderId: "sell-1", quantity: 100, security: SECURITY });
  const pnl = account.settleSell({ fees: 6, netProceeds: 1194, orderId: "sell-1", security: SECURITY });
  assert.equal(pnl, 189);
  assert.equal(account.position(SECURITY).quantity, 0);
  assert.equal(account.cashAvailable, 100189);
  assert.equal(account.totalFees, 11);
});

test("account rejects insufficient cash, unavailable shares and over-reserved fills", () => {
  const account = new Account({ initialCash: 100 });
  assert.throws(() => account.freezeBuy({ amount: 101, orderId: "buy" }), (error) => error.code === "insufficient_available_cash");
  account.freezeBuy({ amount: 50, orderId: "buy" });
  assert.throws(() => account.settleBuy({ availableDate: "x", orderId: "buy", quantity: 1, security: SECURITY, totalCost: 51 }), (error) => error.code === "fill_exceeds_frozen_cash");
  assert.throws(() => account.freezeSell({ orderId: "sell", quantity: 1, security: SECURITY }), (error) => error.code === "insufficient_available_shares");
});
