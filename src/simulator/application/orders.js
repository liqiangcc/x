"use strict";

const { Order } = require("../core/order");
const { OrderSide, OrderStatus, SessionStatus } = require("../core/enums");

function estimateReservation({ estimatedFees = 0, estimatedPrice, quantity, side }) {
  if (side === OrderSide.SELL) return 0;
  if (!Number.isFinite(estimatedPrice) || estimatedPrice <= 0) throw new TypeError("estimatedPrice must be positive for buy orders.");
  if (!Number.isFinite(estimatedFees) || estimatedFees < 0) throw new TypeError("estimatedFees must be non-negative.");
  return estimatedPrice * quantity + estimatedFees;
}

class OrderApplicationService {
  constructor({ account, aliases, session }) {
    this.account = account;
    this.aliases = aliases;
    this.session = session;
    this.orders = new Map();
  }

  #assertDecisionOpen() {
    if (this.session.status !== SessionStatus.WAITING_FOR_DECISION) {
      const error = new Error("Orders can only be edited while waiting for a decision.");
      error.code = "decision_locked";
      throw error;
    }
  }

  #reserve(order, options) {
    const reservedAmount = estimateReservation({ ...options, quantity: order.quantity, side: order.side });
    if (order.side === OrderSide.BUY) {
      this.account.freezeBuy({ amount: reservedAmount, orderId: order.id });
    } else {
      this.account.freezeSell({ orderId: order.id, quantity: order.quantity, security: order.security });
    }
    return reservedAmount;
  }

  create(input) {
    this.#assertDecisionOpen();
    const security = this.aliases.resolve(input.candidateId);
    if (!security) {
      const error = new Error("Unknown candidateId for this session.");
      error.code = "unknown_candidate";
      throw error;
    }
    const order = new Order({ ...input, security, tradingDate: this.session.clock.currentDate });
    this.orders.set(order.id, order);
    try {
      const reservedAmount = this.#reserve(order, input);
      order.accept({ estimatedFees: input.estimatedFees ?? 0, estimatedPrice: input.estimatedPrice ?? null, reservedAmount });
    } catch (error) {
      order.reject(error.code ?? "reservation_failed");
    }
    return order;
  }

  update(orderId, changes) {
    this.#assertDecisionOpen();
    const order = this.get(orderId);
    order.assertMutable();
    const previous = {
      estimatedFees: order.estimatedFees,
      estimatedPrice: order.estimatedPrice,
      quantity: order.quantity,
      reason: order.reason,
      reservedAmount: order.reservedAmount,
    };
    this.account.releaseOrder(order.id);
    try {
      const next = { ...previous, ...changes };
      order.revise(next);
      const reservedAmount = this.#reserve(order, next);
      order.revise({ ...next, reservedAmount });
      return order;
    } catch (error) {
      order.revise(previous);
      this.#reserve(order, previous);
      throw error;
    }
  }

  cancel(orderId) {
    this.#assertDecisionOpen();
    const order = this.get(orderId);
    order.cancel();
    this.account.releaseOrder(order.id);
    return order;
  }

  completeDecision(options) {
    this.#assertDecisionOpen();
    return this.session.completeDecision(options);
  }

  get(orderId) {
    const order = this.orders.get(orderId);
    if (!order) {
      const error = new Error(`Order ${orderId} was not found.`);
      error.code = "order_not_found";
      throw error;
    }
    return order;
  }

  acceptedForDate(date) {
    return [...this.orders.values()].filter((order) => order.tradingDate === date && order.status === OrderStatus.ACCEPTED);
  }
}

module.exports = {
  OrderApplicationService,
  estimateReservation,
};
