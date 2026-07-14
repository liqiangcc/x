import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PerformanceCharts, { points } from "./PerformanceCharts.jsx";
import TradeReview from "./TradeReview.jsx";
import StockCycleReview from "./StockCycleReview.jsx";

describe("review components", () => {
  it("renders equity and drawdown curves with benchmark fallback", () => {
    render(<PerformanceCharts benchmark={{ status: "benchmark_unavailable" }} equityCurve={[{ equity: 100 }, { equity: 110 }, { equity: 99 }]} />);
    expect(screen.getByRole("img", { name: "账户权益曲线" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "回撤曲线" })).toBeInTheDocument();
    expect(screen.getByText(/TODO/)).toBeInTheDocument();
    expect(points([1, 2], 100, 50)).toContain("100,0");
  });

  it("associates an order with its reason, candidate evidence and fill", () => {
    render(<TradeReview candidates={[]} fills={[{ orderId: "o1", price: 10.01, slippageAmount: 1 }]} orders={[{ candidateId: "c1", candidateSnapshot: { alias: "候选A", evidence: { breakout_margin_pct: 1.2 } }, id: "o1", quantity: 100, reason: "首次突破", side: "buy", status: "filled", tradingDate: "2026-07-01" }]} />);
    expect(screen.getByText("首次突破")).toBeInTheDocument();
    expect(screen.getByText("1.20%")).toBeInTheDocument();
    expect(screen.getByText("¥10.01 / —")).toBeInTheDocument();
  });

  it("shows decision and fill dates in real-name review mode", () => {
    render(<TradeReview anonymousMode={false} candidates={[]} fills={[{ date: "2026-07-02", dayIndex: 2, fees: { total: 5 }, grossAmount: 1000, orderId: "o1", price: 10, slippageAmount: 1 }]} orders={[{ candidateId: "c1", candidateSnapshot: { alias: "候选A", security: { code: "600001", market: 1, name: "示例股份" } }, dayIndex: 1, estimatedPrice: 9.9, id: "o1", quantity: 100, reason: "首次突破", side: "buy", status: "filled", tradingDate: "2026-07-01" }]} />);
    expect(screen.getByText(/2026-07-01/)).toBeInTheDocument();
    expect(screen.getByText(/2026-07-02/)).toBeInTheDocument();
    expect(screen.getByText("示例股份 / 600001")).toBeInTheDocument();
  });

  it("renders per-stock cycle return, holding days, buys and BOLL state", () => {
    render(<StockCycleReview cycles={[{ alias: "候选A", bollAboveMiddle: true, buyCount: 2, candidateId: "cand_a", cycleNumber: 1, holdingDays: 5, remainingQuantity: 100, returnPct: 8.5, startDayIndex: 3, status: "open", totalPnl: 85 }]} />);
    expect(screen.getByText("+¥85.00")).toBeInTheDocument();
    expect(screen.getByText("+8.50%")).toBeInTheDocument();
    expect(screen.getByText("5 个交易日")).toBeInTheDocument();
    expect(screen.getByText("2 次")).toBeInTheDocument();
    expect(screen.getByText("已站上")).toBeInTheDocument();
  });
});
