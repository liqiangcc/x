"use strict";

function values(definition) {
  return Object.freeze(Object.values(definition));
}

const DataMode = Object.freeze({
  LEGACY_APPROXIMATE: "legacy_approximate",
  HISTORICAL_ACCURATE: "historical_accurate",
});

const SessionMode = Object.freeze({
  MANUAL: "manual",
  BLIND: "blind",
});

const SessionStatus = Object.freeze({
  CREATED: "created",
  WAITING_FOR_DECISION: "waiting_for_decision",
  RUNNING: "running",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  FAILED: "failed",
});

const OrderSide = Object.freeze({
  BUY: "buy",
  SELL: "sell",
});

const OrderStatus = Object.freeze({
  SUBMITTED: "submitted",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  FILLED: "filled",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
});

const OrderType = Object.freeze({
  NEXT_OPEN: "next_open",
});

const PriceView = Object.freeze({
  LEGACY_FORWARD_ADJUSTED: "legacy_forward_adjusted",
  RAW: "raw",
  FORWARD_POINT_IN_TIME: "forward_point_in_time",
});

const EventType = Object.freeze({
  SESSION_CREATED: "SessionCreated",
  SESSION_STARTED: "SessionStarted",
  MARKET_ADVANCED: "MarketAdvanced",
  MARKET_CLOSED: "MarketClosed",
  CANDIDATE_SNAPSHOT_CREATED: "CandidateSnapshotCreated",
  DECISION_REQUESTED: "DecisionRequested",
  DECISION_COMPLETED: "DecisionCompleted",
  ORDER_SUBMITTED: "OrderSubmitted",
  ORDER_ACCEPTED: "OrderAccepted",
  ORDER_REJECTED: "OrderRejected",
  ORDER_CANCELLED: "OrderCancelled",
  ORDER_FILLED: "OrderFilled",
  ORDER_EXPIRED: "OrderExpired",
  PORTFOLIO_UPDATED: "PortfolioUpdated",
  IDENTITY_REVEALED: "IdentityRevealed",
  SESSION_CLONED: "SessionCloned",
  SESSION_COMPLETED: "SessionCompleted",
});

module.exports = {
  DataMode,
  DataModeValues: values(DataMode),
  EventType,
  EventTypeValues: values(EventType),
  OrderSide,
  OrderSideValues: values(OrderSide),
  OrderStatus,
  OrderStatusValues: values(OrderStatus),
  OrderType,
  OrderTypeValues: values(OrderType),
  PriceView,
  PriceViewValues: values(PriceView),
  SessionMode,
  SessionModeValues: values(SessionMode),
  SessionStatus,
  SessionStatusValues: values(SessionStatus),
};
