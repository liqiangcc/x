import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import OrderEditor, { estimate, quantityForAmount } from "./OrderEditor.jsx";
import PortfolioPanel from "./PortfolioPanel.jsx";

describe("OrderEditor", () => {
  it("requires a reason and confirms estimated money, fees and frozen assets", async () => {
    const submit = vi.fn().mockResolvedValue({});
    render(<OrderEditor candidate={{ alias: "候选A", candidateId: "cand_a" }} estimatedPrice={10} onSubmit={submit} />);
    expect(screen.getByRole("button", { name: "预览订单" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("交易理由"), { target: { value: "首次突破" } });
    fireEvent.click(screen.getByRole("button", { name: "预览订单" }));
    expect(screen.getByRole("dialog", { name: "确认订单" })).toHaveTextContent("冻结资金由服务端按适用涨停价计算");
    const confirm = screen.getByRole("button", { name: "确认提交" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ candidateId: "cand_a", quantity: 1000, reason: "首次突破", side: "buy" })));
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("estimates sell stamp duty separately", () => {
    expect(estimate(10, 100, "sell")).toMatchObject({ gross: 1000, reserved: 100, fees: 5.5 });
  });

  it("calculates buy quantity from the editable amount in 100-share lots", () => {
    expect(quantityForAmount(1050, 10)).toBe(100);
    expect(quantityForAmount(999, 10)).toBe(0);
  });
});

describe("PortfolioPanel", () => {
  it("shows marked holding return, return rate and inclusive trading days", () => {
    render(<PortfolioPanel portfolio={{
      cashAvailable: 9000,
      equity: 10100,
      frozenCash: 0,
      marketValue: 1100,
      positions: [{
        alias: "候选A",
        availableQuantity: 100,
        averageCost: 10,
        candidateId: "cand_a",
        currentPrice: 11,
        holdingDays: 3,
        priceDayOffset: 0,
        quantity: 100,
        unrealizedPnl: 100,
        unrealizedPnlPct: 10,
      }],
      realizedPnl: 0,
      unrealizedPnl: 100,
    }} />);
    expect(screen.getByText(/持仓收益 \+¥100.00 · \+10.00%/)).toBeInTheDocument();
    expect(screen.getByText("持仓 3 个交易日")).toBeInTheDocument();
    expect(screen.getByText(/成本 ¥10.00 · 当前 ¥11.00/)).toBeInTheDocument();
  });
});
