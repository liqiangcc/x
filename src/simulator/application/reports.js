"use strict";

function identityRows(entry) {
  if (!entry.session.revealedAt) return [];
  return entry.session.candidateSnapshot.candidates.map((candidate) => ({
    alias: candidate.alias,
    candidateId: candidate.candidateId,
    ...entry.aliases.resolve(candidate.candidateId),
  }));
}

function buildSessionReport(entry) {
  const account = entry.session.finalAccountSnapshot ?? entry.account.snapshot();
  return {
    account,
    benchmark: { status: "benchmark_unavailable" },
    candidates: entry.session.candidateSnapshot.candidates,
    dataMode: "legacy_approximate",
    dataVersion: entry.dataVersion,
    events: entry.session.events,
    fills: entry.engine?.fills ?? [],
    identities: identityRows(entry),
    lineage: entry.lineage ?? null,
    orders: entry.orderService ? [...entry.orderService.orders.values()].map((order) => ({
      candidateId: order.candidateId,
      estimatedFees: order.estimatedFees,
      estimatedPrice: order.estimatedPrice,
      id: order.id,
      quantity: order.quantity,
      reason: order.reason,
      rejectionReason: order.rejectionReason,
      side: order.side,
      status: order.status,
      tradingDate: order.tradingDate,
    })) : [],
    revealedAt: entry.session.revealedAt ?? null,
    session: entry.session.snapshot(),
  };
}

module.exports = {
  buildSessionReport,
  identityRows,
};
