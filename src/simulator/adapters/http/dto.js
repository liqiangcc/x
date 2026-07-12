"use strict";

const { holdingDto } = require("../../selection/candidate_dto");

function configDto(config = {}) {
  return {
    endDate: config.endDate ?? null,
    execution: config.execution ?? null,
    initialCash: config.initialCash ?? 100000,
    mode: config.mode ?? "manual",
    selection: config.selection ?? null,
    startDate: config.startDate ?? null,
  };
}

function accountDto(snapshot, aliases) {
  return {
    cash: snapshot.cash,
    cashAvailable: snapshot.cashAvailable,
    equity: snapshot.equity,
    frozenCash: snapshot.frozenCash,
    marketValue: snapshot.marketValue,
    positions: snapshot.positions.map((position) => {
      const identity = aliases.publicForSecurity(position.security);
      if (!identity) {
        const error = new Error("Anonymous holding mapping is unavailable.");
        error.code = "anonymous_mapping_unavailable";
        throw error;
      }
      return holdingDto(position, identity);
    }),
    realizedPnl: snapshot.realizedPnl,
    totalFees: snapshot.totalFees,
    unrealizedPnl: snapshot.unrealizedPnl,
  };
}

function sessionDto(entry) {
  const snapshot = entry.session.snapshot();
  return {
    account: accountDto(entry.account.snapshot(), entry.aliases),
    candidateSnapshot: snapshot.candidateSnapshot,
    clock: snapshot.clock,
    config: configDto(entry.config),
    dataMode: "legacy_approximate",
    finalAccountSnapshot: snapshot.finalAccountSnapshot ? accountDto(snapshot.finalAccountSnapshot, entry.aliases) : null,
    id: snapshot.id,
    lineage: entry.lineage ?? null,
    mode: snapshot.mode,
    revealedAt: snapshot.revealedAt,
    selectionEffectiveDate: entry.selectionEffectiveDate ?? null,
    status: snapshot.status,
    version: snapshot.version,
  };
}

function eventDto(event) {
  return {
    payload: event.payload,
    type: event.type,
    version: event.version,
  };
}

function fillDto(fill) {
  return {
    cashAmount: fill.cashAmount,
    dataMode: fill.dataMode,
    date: fill.date,
    fees: fill.fees,
    grossAmount: fill.grossAmount,
    id: fill.id,
    orderId: fill.orderId,
    price: fill.price,
    priceView: fill.priceView,
    quantity: fill.quantity,
    ruleApproximation: fill.ruleApproximation,
    side: fill.side,
    slippageAmount: fill.slippageAmount,
  };
}

module.exports = {
  accountDto,
  configDto,
  eventDto,
  fillDto,
  sessionDto,
};
