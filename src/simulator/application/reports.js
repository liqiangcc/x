"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { accountDto, eventDto, fillDto, sessionDto } = require("../adapters/http/dto");

function finite(values) {
  return values.filter(Number.isFinite);
}

function metric(value) {
  return Number.isFinite(value) ? Math.round(value * 1e12) / 1e12 : value;
}

function mean(values) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleDeviation(values) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

function equityReturns(snapshots) {
  const returns = [];
  for (let index = 1; index < snapshots.length; index += 1) {
    const previous = snapshots[index - 1].equity;
    const current = snapshots[index].equity;
    if (Number.isFinite(previous) && previous > 0 && Number.isFinite(current)) returns.push(current / previous - 1);
  }
  return returns;
}

function maximumDrawdown(snapshots) {
  let peak = null;
  let maximum = 0;
  for (const snapshot of snapshots) {
    if (!Number.isFinite(snapshot.equity)) continue;
    peak = peak === null ? snapshot.equity : Math.max(peak, snapshot.equity);
    if (peak > 0) maximum = Math.max(maximum, (peak - snapshot.equity) / peak);
  }
  return maximum;
}

function calendarDays(snapshots) {
  if (snapshots.length < 2) return 0;
  const start = Date.parse(snapshots[0].date);
  const end = Date.parse(snapshots.at(-1).date);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max((end - start) / 86400000, 0) : 0;
}

function calculatePerformance({ accountSnapshots = [], fills = [], initialCash = 100000, orders = [] } = {}) {
  const snapshots = [...accountSnapshots].filter((item) => Number.isFinite(item?.equity)).sort((left, right) => String(left.date).localeCompare(String(right.date)));
  const endingEquity = snapshots.at(-1)?.equity ?? initialCash;
  const totalReturn = metric(initialCash > 0 ? endingEquity / initialCash - 1 : 0);
  const days = calendarDays(snapshots);
  const annualizedReturn = days > 0 && totalReturn > -1 ? (1 + totalReturn) ** (365 / days) - 1 : totalReturn;
  const returns = equityReturns(snapshots);
  const volatility = sampleDeviation(returns) * Math.sqrt(252);
  const downside = returns.filter((value) => value < 0);
  const sharpe = volatility > 0 ? (mean(returns) * 252) / volatility : 0;
  const downsideVolatility = sampleDeviation(downside) * Math.sqrt(252);
  const sortino = downsideVolatility > 0 ? (mean(returns) * 252) / downsideVolatility : 0;
  const sellResults = finite(fills.filter((fill) => fill.side === "sell").map((fill) => fill.realizedPnl));
  const wins = sellResults.filter((value) => value > 0);
  const losses = sellResults.filter((value) => value < 0);
  const grossProfit = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  const totalFees = fills.reduce((sum, fill) => sum + Number(fill.fees?.total ?? 0), 0);
  const totalSlippage = fills.reduce((sum, fill) => sum + Number(fill.slippageAmount ?? 0), 0);
  const turnover = mean(snapshots.map((item) => item.equity)) > 0
    ? fills.reduce((sum, fill) => sum + Number(fill.grossAmount ?? 0), 0) / mean(snapshots.map((item) => item.equity))
    : 0;
  const final = snapshots.at(-1) ?? {};
  return {
    annualizedReturn: metric(annualizedReturn),
    closedTradeCount: sellResults.length,
    endingEquity,
    fees: totalFees,
    initialCash,
    maxDrawdown: metric(maximumDrawdown(snapshots)),
    orderCount: orders.length,
    profitLossRatio: grossLoss > 0 ? metric(grossProfit / grossLoss) : (grossProfit > 0 ? null : 0),
    realizedPnl: Number(final.realizedPnl ?? 0),
    sharpe: metric(sharpe),
    slippage: totalSlippage,
    sortino: metric(sortino),
    totalReturn,
    turnover: metric(turnover),
    unrealizedPnl: Number(final.unrealizedPnl ?? 0),
    volatility: metric(volatility),
    winRate: sellResults.length > 0 ? metric(wins.length / sellResults.length) : null,
  };
}

function benchmarkReport(series = null) {
  if (!Array.isArray(series) || series.length < 2) return { status: "benchmark_unavailable" };
  const first = series[0].close;
  const last = series.at(-1).close;
  if (!Number.isFinite(first) || first <= 0 || !Number.isFinite(last)) return { status: "benchmark_unavailable" };
  return { endDate: series.at(-1).date, startDate: series[0].date, status: "available", totalReturn: metric(last / first - 1) };
}

function detectBenchmark(paths = [
  path.join("data", "benchmark", "csi300.json"),
  path.join("data", "kline", "daily", "000300.json"),
]) {
  return paths.find((filePath) => fs.existsSync(filePath)) ?? null;
}

function identityRows(entry) {
  if (!entry.session.revealedAt) return [];
  return entry.session.candidateSnapshot.candidates.map((candidate) => ({
    alias: candidate.alias,
    candidateId: candidate.candidateId,
    ...entry.aliases.resolve(candidate.candidateId),
  }));
}

function buildSessionReport(entry) {
  const account = accountDto(entry.session.finalAccountSnapshot ?? entry.account.snapshot(), entry.aliases);
  const candidates = entry.session.candidateSnapshot.candidates;
  const orders = entry.orderService ? [...entry.orderService.orders.values()].map((order) => ({
    candidateId: order.candidateId,
    candidateSnapshot: candidates.find((candidate) => candidate.candidateId === order.candidateId) ?? null,
    estimatedFees: order.estimatedFees,
    estimatedPrice: order.estimatedPrice,
    id: order.id,
    quantity: order.quantity,
    reason: order.reason,
    rejectionReason: order.rejectionReason,
    side: order.side,
    status: order.status,
    tradingDate: order.tradingDate,
  })) : [];
  return {
    account,
    benchmark: benchmarkReport(entry.benchmarkSeries),
    candidates,
    dataMode: "legacy_approximate",
    dataVersion: entry.dataVersion,
    events: entry.session.events.map(eventDto),
    equityCurve: (entry.accountHistory ?? []).map((snapshot) => ({
      date: snapshot.date,
      equity: snapshot.equity,
      realizedPnl: snapshot.realizedPnl,
      unrealizedPnl: snapshot.unrealizedPnl,
    })),
    fills: (entry.engine?.fills ?? []).map(fillDto),
    identities: identityRows(entry),
    lineage: entry.lineage ?? null,
    orders,
    performance: calculatePerformance({
      accountSnapshots: entry.accountHistory ?? [{ date: entry.session.clock.currentDate, ...account }],
      fills: entry.engine?.fills ?? [],
      initialCash: entry.account.initialCash,
      orders,
    }),
    revealedAt: entry.session.revealedAt ?? null,
    session: sessionDto(entry),
  };
}

module.exports = {
  benchmarkReport,
  buildSessionReport,
  calculatePerformance,
  detectBenchmark,
  equityReturns,
  identityRows,
  maximumDrawdown,
};
