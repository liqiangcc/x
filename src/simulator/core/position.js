"use strict";

const { normalizeSecurityId } = require("./contracts");

function positiveQuantity(value, field = "quantity") {
  if (!Number.isInteger(value) || value <= 0) throw new TypeError(`${field} must be a positive integer.`);
  return value;
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 1e6) / 1e6;
}

class Position {
  constructor({ security, quantity = 0, averageCost = 0 } = {}) {
    this.security = normalizeSecurityId(security);
    if (!Number.isInteger(quantity) || quantity < 0) throw new TypeError("quantity must be a non-negative integer.");
    if (!Number.isFinite(averageCost) || averageCost < 0) throw new TypeError("averageCost must be non-negative.");
    this.quantity = quantity;
    this.averageCost = quantity === 0 ? 0 : averageCost;
    this.frozen = new Map();
    this.unsettled = [];
    this.realizedPnl = 0;
  }

  get frozenQuantity() {
    return [...this.frozen.values()].reduce((sum, quantity) => sum + quantity, 0);
  }

  get unsettledQuantity() {
    return this.unsettled.reduce((sum, lot) => sum + lot.quantity, 0);
  }

  get availableQuantity() {
    return this.quantity - this.frozenQuantity - this.unsettledQuantity;
  }

  freeze(orderId, quantity) {
    positiveQuantity(quantity);
    if (this.frozen.has(orderId)) throw new Error(`Shares are already frozen for order ${orderId}.`);
    if (quantity > this.availableQuantity) {
      const error = new Error("Insufficient available shares.");
      error.code = "insufficient_available_shares";
      throw error;
    }
    this.frozen.set(orderId, quantity);
  }

  release(orderId) {
    return this.frozen.delete(orderId);
  }

  buy({ quantity, totalCost, availableDate }) {
    positiveQuantity(quantity);
    if (!Number.isFinite(totalCost) || totalCost <= 0) throw new TypeError("totalCost must be positive.");
    const oldCost = this.averageCost * this.quantity;
    this.quantity += quantity;
    this.averageCost = (oldCost + totalCost) / this.quantity;
    this.unsettled.push({ availableDate, quantity });
  }

  sell({ orderId, netProceeds }) {
    const quantity = this.frozen.get(orderId);
    if (!quantity) throw new Error(`No frozen shares for order ${orderId}.`);
    if (!Number.isFinite(netProceeds) || netProceeds < 0) throw new TypeError("netProceeds must be non-negative.");
    this.frozen.delete(orderId);
    const costBasis = this.averageCost * quantity;
    this.quantity -= quantity;
    const realizedPnl = roundMoney(netProceeds - costBasis);
    this.realizedPnl = roundMoney(this.realizedPnl + realizedPnl);
    if (this.quantity === 0) this.averageCost = 0;
    return realizedPnl;
  }

  releaseForDate(date) {
    this.unsettled = this.unsettled.filter((lot) => lot.availableDate > date);
    return this.availableQuantity;
  }

  mark(price) {
    if (!Number.isFinite(price) || price < 0) throw new TypeError("mark price must be non-negative.");
    const marketValue = this.quantity * price;
    return {
      availableQuantity: this.availableQuantity,
      averageCost: this.averageCost,
      frozenQuantity: this.frozenQuantity,
      marketValue,
      quantity: this.quantity,
      realizedPnl: this.realizedPnl,
      security: this.security,
      unsettledQuantity: this.unsettledQuantity,
      unrealizedPnl: marketValue - this.averageCost * this.quantity,
    };
  }
}

module.exports = {
  Position,
  positiveQuantity,
  roundMoney,
};
