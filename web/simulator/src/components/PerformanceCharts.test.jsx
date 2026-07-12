import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PerformanceCharts, { points } from "./PerformanceCharts.jsx";
import TradeReview from "./TradeReview.jsx";

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
    expect(screen.getByText(/成交价 10.01/)).toBeInTheDocument();
  });
});
