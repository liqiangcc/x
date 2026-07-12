"use strict";

const { securityKey } = require("./contracts");
const { Position } = require("./position");
const { roundMoney } = require("./position");

class Account {
  constructor({ initialCash = 100000 } = {}) {
    if (!Number.isFinite(initialCash) || initialCash <= 0) throw new TypeError("initialCash must be positive.");
    this.initialCash = initialCash;
    this.cashAvailable = initialCash;
    this.frozenCash = new Map();
    this.positions = new Map();
    this.realizedPnl = 0;
    this.totalFees = 0;
  }

  get frozenCashTotal() {
    return [...this.frozenCash.values()].reduce((sum, amount) => sum + amount, 0);
  }

  position(security, { create = false } = {}) {
    const key = securityKey(security);
    if (!this.positions.has(key) && create) this.positions.set(key, new Position({ security }));
    return this.positions.get(key) ?? null;
  }

  freezeBuy({ amount, orderId }) {
    if (!Number.isFinite(amount) || amount <= 0) throw new TypeError("freeze amount must be positive.");
    if (this.frozenCash.has(orderId)) throw new Error(`Cash is already frozen for order ${orderId}.`);
    if (amount > this.cashAvailable) {
      const error = new Error("Insufficient available cash.");
      error.code = "insufficient_available_cash";
      throw error;
    }
    this.cashAvailable = roundMoney(this.cashAvailable - amount);
    this.frozenCash.set(orderId, amount);
  }

  freezeSell({ orderId, quantity, security }) {
    const position = this.position(security);
    if (!position) {
      const error = new Error("No position is available for sale.");
      error.code = "insufficient_available_shares";
      throw error;
    }
    position.freeze(orderId, quantity);
  }

  releaseOrder(orderId) {
    if (this.frozenCash.has(orderId)) {
      this.cashAvailable = roundMoney(this.cashAvailable + this.frozenCash.get(orderId));
      this.frozenCash.delete(orderId);
      return true;
    }
    for (const position of this.positions.values()) {
      if (position.release(orderId)) return true;
    }
    return false;
  }

  settleBuy({ availableDate, fees = 0, orderId, quantity, security, totalCost }) {
    const reserved = this.frozenCash.get(orderId);
    if (!Number.isFinite(reserved)) throw new Error(`No frozen cash for order ${orderId}.`);
    if (totalCost > reserved + Number.EPSILON) {
      const error = new Error("Fill cost exceeds frozen cash.");
      error.code = "fill_exceeds_frozen_cash";
      throw error;
    }
    this.frozenCash.delete(orderId);
    this.cashAvailable = roundMoney(this.cashAvailable + reserved - totalCost);
    this.totalFees = roundMoney(this.totalFees + fees);
    this.position(security, { create: true }).buy({ availableDate, quantity, totalCost });
  }

  settleSell({ fees = 0, netProceeds, orderId, security }) {
    const position = this.position(security);
    if (!position) throw new Error("Position not found.");
    const realizedPnl = position.sell({ netProceeds, orderId });
    this.cashAvailable = roundMoney(this.cashAvailable + netProceeds);
    this.realizedPnl = roundMoney(this.realizedPnl + realizedPnl);
    this.totalFees = roundMoney(this.totalFees + fees);
    return realizedPnl;
  }

  openTradingDate(date) {
    for (const position of this.positions.values()) position.releaseForDate(date);
  }

  snapshot({ prices = {} } = {}) {
    const positions = [...this.positions.entries()]
      .filter(([, position]) => position.quantity > 0)
      .map(([key, position]) => position.mark(Number(prices[key] ?? position.averageCost)));
    const marketValue = positions.reduce((sum, position) => sum + position.marketValue, 0);
    const cash = this.cashAvailable + this.frozenCashTotal;
    return Object.freeze({
      cash,
      cashAvailable: this.cashAvailable,
      equity: cash + marketValue,
      frozenCash: this.frozenCashTotal,
      marketValue,
      positions,
      realizedPnl: this.realizedPnl,
      totalFees: this.totalFees,
      unrealizedPnl: positions.reduce((sum, position) => sum + position.unrealizedPnl, 0),
    });
  }
}

module.exports = {
  Account,
};
