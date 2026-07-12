import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import OrderEditor, { estimate } from "./OrderEditor.jsx";

describe("OrderEditor", () => {
  it("requires a reason and confirms estimated money, fees and frozen assets", async () => {
    const submit = vi.fn().mockResolvedValue({});
    render(<OrderEditor candidate={{ alias: "候选A", candidateId: "cand_a" }} estimatedPrice={10} onSubmit={submit} />);
    expect(screen.getByRole("button", { name: "预览订单" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("交易理由"), { target: { value: "首次突破" } });
    fireEvent.click(screen.getByRole("button", { name: "预览订单" }));
    expect(screen.getByRole("dialog", { name: "确认订单" })).toHaveTextContent("冻结资金 ¥1,005.00");
    fireEvent.click(screen.getByRole("button", { name: "确认提交" }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ candidateId: "cand_a", quantity: 100, reason: "首次突破", side: "buy" })));
  });

  it("estimates sell stamp duty separately", () => {
    expect(estimate(10, 100, "sell")).toMatchObject({ gross: 1000, reserved: 100, fees: 5.5 });
  });
});
