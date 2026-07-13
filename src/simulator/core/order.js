"use strict";

const { randomUUID } = require("node:crypto");
const { assertNonEmptyString, normalizeSecurityId } = require("./contracts");
const { OrderSide, OrderStatus, OrderType } = require("./enums");

const MUTABLE_STATUSES = new Set([OrderStatus.SUBMITTED, OrderStatus.ACCEPTED]);

class Order {
  constructor({ candidateId, id = randomUUID(), quantity, reason, security, side, tradingDate }) {
    if (!Object.values(OrderSide).includes(side)) throw new TypeError("side must be buy or sell.");
    if (!Number.isInteger(quantity) || quantity <= 0) throw new TypeError("quantity must be a positive integer.");
    this.id = id;
    this.candidateId = assertNonEmptyString(candidateId, "candidateId");
    this.security = normalizeSecurityId(security);
    this.side = side;
    this.quantity = quantity;
    this.reason = assertNonEmptyString(reason, "reason");
    this.tradingDate = tradingDate;
    this.type = OrderType.NEXT_OPEN;
    this.status = OrderStatus.SUBMITTED;
    this.rejectionReason = null;
    this.estimatedPrice = null;
    this.estimatedFees = 0;
    this.reservedAmount = 0;
    this.referencePrice = null;
    this.reservationLimitRate = null;
  }

  assertMutable() {
    if (!MUTABLE_STATUSES.has(this.status)) {
      const error = new Error(`Order ${this.id} is not mutable in status ${this.status}.`);
      error.code = "order_not_mutable";
      throw error;
    }
  }

  accept({ estimatedFees = 0, estimatedPrice = null, referencePrice = null, reservationLimitRate = null, reservedAmount = 0 } = {}) {
    if (this.status !== OrderStatus.SUBMITTED) throw new Error("Only submitted orders can be accepted.");
    this.estimatedFees = estimatedFees;
    this.estimatedPrice = estimatedPrice;
    this.reservedAmount = reservedAmount;
    this.referencePrice = referencePrice;
    this.reservationLimitRate = reservationLimitRate;
    this.status = OrderStatus.ACCEPTED;
    return this;
  }

  reject(reason) {
    if (this.status !== OrderStatus.SUBMITTED) throw new Error("Only submitted orders can be rejected.");
    this.rejectionReason = assertNonEmptyString(reason, "rejectionReason");
    this.status = OrderStatus.REJECTED;
    return this;
  }

  revise({ estimatedFees = this.estimatedFees, estimatedPrice = this.estimatedPrice, quantity = this.quantity, reason = this.reason, referencePrice = this.referencePrice, reservationLimitRate = this.reservationLimitRate, reservedAmount = this.reservedAmount }) {
    this.assertMutable();
    if (!Number.isInteger(quantity) || quantity <= 0) throw new TypeError("quantity must be a positive integer.");
    this.quantity = quantity;
    this.reason = assertNonEmptyString(reason, "reason");
    this.estimatedFees = estimatedFees;
    this.estimatedPrice = estimatedPrice;
    this.reservedAmount = reservedAmount;
    this.referencePrice = referencePrice;
    this.reservationLimitRate = reservationLimitRate;
    return this;
  }

  cancel() {
    this.assertMutable();
    this.status = OrderStatus.CANCELLED;
    return this;
  }

  expire(reason) {
    if (this.status !== OrderStatus.ACCEPTED) throw new Error("Only accepted orders can expire.");
    this.rejectionReason = assertNonEmptyString(reason, "expirationReason");
    this.status = OrderStatus.EXPIRED;
    return this;
  }

  fill(fillId) {
    if (this.status !== OrderStatus.ACCEPTED) throw new Error("Only accepted orders can fill.");
    this.fillId = assertNonEmptyString(fillId, "fillId");
    this.status = OrderStatus.FILLED;
    return this;
  }
}

module.exports = {
  MUTABLE_STATUSES,
  Order,
};
