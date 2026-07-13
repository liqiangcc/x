import { describe, expect, it, vi } from "vitest";
import { cachedChart, mergePortfolioSnapshot } from "./TradePage.jsx";

describe("stock detail chart loading", () => {
  it("deduplicates concurrent chart requests for the same account, candidate and day", async () => {
    const client = { getStockChart: vi.fn().mockResolvedValue({ alias: "候选A", daily: [], yearly: [] }) };
    const [first, second] = await Promise.all([
      cachedChart(client, "account-flicker", "candidate-flicker", 3),
      cachedChart(client, "account-flicker", "candidate-flicker", 3),
    ]);
    expect(client.getStockChart).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it("merges an order account snapshot without losing marked portfolio prices", () => {
    const current = {
      cash: 10000,
      equity: 12000,
      marketValue: 2000,
      positions: [{ availableQuantity: 100, candidateId: "candidate-a", currentPrice: 12, holdingDays: 3, quantity: 100 }],
    };
    const merged = mergePortfolioSnapshot(current, {
      cash: 9000,
      cashAvailable: 8500,
      frozenCash: 500,
      positions: [{ availableQuantity: 0, candidateId: "candidate-a", quantity: 100 }],
      realizedPnl: 10,
      totalFees: 5,
    });
    expect(merged).toMatchObject({ cash: 9000, equity: 12000, frozenCash: 500, marketValue: 2000 });
    expect(merged.positions[0]).toMatchObject({ availableQuantity: 0, currentPrice: 12, holdingDays: 3 });
  });
});
