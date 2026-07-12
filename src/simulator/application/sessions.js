"use strict";

const { OrderSide, OrderStatus, SessionStatus } = require("../core/enums");
const { executionBlockReason } = require("../mechanisms/a_share_rules");
const { createFill } = require("../mechanisms/fill_model");

class TradingSessionEngine {
  constructor({ account, candidateSnapshotFactory, executionConfig = {}, klineRepository, orderService, session }) {
    this.account = account;
    this.candidateSnapshotFactory = candidateSnapshotFactory;
    this.executionConfig = executionConfig;
    this.klineRepository = klineRepository;
    this.orderService = orderService;
    this.session = session;
    this.fills = [];
  }

  #nextAfter(date) {
    const index = this.session.clock.dates.indexOf(date);
    return this.session.clock.dates[index + 1] ?? date;
  }

  #expire(order, reason) {
    this.account.releaseOrder(order.id);
    order.expire(reason);
  }

  async advance({ expectedVersion = this.session.version } = {}) {
    if (this.session.status !== SessionStatus.RUNNING) {
      const error = new Error("advance requires a running session.");
      error.code = "invalid_session_state";
      throw error;
    }
    this.session.assertVersion(expectedVersion);
    const decisionDate = this.session.clock.currentDate;
    const executionDate = this.session.clock.nextDate;
    if (!executionDate) {
      const error = new Error("No next trading date is available.");
      error.code = "end_of_calendar";
      throw error;
    }
    this.account.openTradingDate(executionDate);

    for (const order of this.orderService.acceptedForDate(decisionDate)) {
      const result = await this.klineRepository.getLegacyBar({ ...order.security, date: executionDate });
      const bar = result.bar;
      const blocked = executionBlockReason({ bar, side: order.side });
      if (blocked) {
        this.#expire(order, blocked);
        continue;
      }
      try {
        const fill = createFill({ bar, executionConfig: this.executionConfig, order });
        if (order.side === OrderSide.BUY) {
          this.account.settleBuy({
            availableDate: this.#nextAfter(executionDate),
            fees: fill.fees.total,
            orderId: order.id,
            quantity: order.quantity,
            security: order.security,
            totalCost: fill.cashAmount,
          });
        } else {
          this.account.settleSell({
            fees: fill.fees.total,
            netProceeds: fill.cashAmount,
            orderId: order.id,
            security: order.security,
          });
        }
        order.fill(fill.id);
        this.fills.push(fill);
      } catch (error) {
        this.#expire(order, error.code ?? "execution_failed");
      }
    }

    const candidateSnapshot = await this.candidateSnapshotFactory(executionDate);
    return this.session.advance({ candidateSnapshot, expectedVersion });
  }

  async finish({ expectedVersion = this.session.version } = {}) {
    this.session.assertVersion(expectedVersion);
    for (const order of this.orderService.orders.values()) {
      if (order.status === OrderStatus.ACCEPTED) {
        this.account.releaseOrder(order.id);
        order.cancel();
      }
    }
    const prices = {};
    for (const [key, position] of this.account.positions) {
      if (position.quantity === 0) continue;
      const result = await this.klineRepository.getLegacyBar({ ...position.security, date: this.session.clock.currentDate });
      if (Number.isFinite(result.bar?.close)) prices[key] = result.bar.close;
    }
    return this.session.finish({ accountSnapshot: this.account.snapshot({ prices }), expectedVersion });
  }
}

module.exports = {
  TradingSessionEngine,
};
