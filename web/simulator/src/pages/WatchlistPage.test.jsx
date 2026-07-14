import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import WatchlistPage from "./WatchlistPage.jsx";
import { SessionProvider, useSession } from "../state/SessionContext.jsx";

function Seed({ children }) {
  const { session, setSession } = useSession();
  if (!window.__watchlistSeeded) {
    window.__watchlistSeeded = true;
    queueMicrotask(() => setSession({ clock: { currentDate: "2026-07-01", nextDate: "2026-07-02" }, id: "a1", status: "waiting_for_decision", version: 1 }));
  }
  return <>{children}<button onClick={() => setSession({ ...session, clock: { currentDate: "2026-07-02" }, version: 2 })}>推进测试</button></>;
}

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

describe("WatchlistPage", () => {
  it("shows the full compact summary and confirms a buy from the list", async () => {
    window.__watchlistSeeded = false;
    const item = { alias: "候选A", candidateId: "cand_a", detail: {
      boll: { aboveMiddle: true, justCrossedMiddle: true, middle: 10 }, currentClose: 11,
      holding: { availableQuantity: 100, averageCost: 10, buyCount: 2, holdingDays: 5, quantity: 100, unrealizedPnl: 100, unrealizedPnlPct: 10 },
      signal: { changePct: 8, dayIndex: 3, daysSince: 4, signalClose: 10.2, source: "exact" },
    }, signal: { source: "exact" } };
    const client = {
      createOrder: vi.fn().mockResolvedValue({ order: { id: "o1", status: "accepted" }, sessionVersion: 2 }),
      getWatchlist: vi.fn().mockResolvedValue({ items: [item] }),
      removeWatchlist: vi.fn(),
    };
    render(<MemoryRouter><SessionProvider client={client}><Seed><WatchlistPage /></Seed></SessionProvider></MemoryRouter>);
    expect(await screen.findByText("第 3 个交易日")).toBeInTheDocument();
    expect(screen.getByText("+10.00%")).toBeInTheDocument();
    expect(screen.getByText("已站上")).toBeInTheDocument();
    expect(screen.getByLabelText("BOLL中轨")).toHaveValue("crossed");
    expect(screen.queryByText("信号发生")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("BOLL中轨"), { target: { value: "below" } });
    expect(screen.queryByRole("heading", { name: "候选A" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("BOLL中轨"), { target: { value: "above" } });
    const callsBeforeAdvance = client.getWatchlist.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "推进测试" }));
    await waitFor(() => expect(client.getWatchlist.mock.calls.length).toBeGreaterThan(callsBeforeAdvance));
    fireEvent.click(screen.getByRole("button", { name: "操作候选A" }));
    fireEvent.click(screen.getByRole("button", { name: "买入" }));
    fireEvent.change(screen.getByLabelText("交易理由"), { target: { value: "自选买入练习" } });
    fireEvent.click(screen.getByRole("button", { name: "预览订单" }));
    fireEvent.click(screen.getByRole("button", { name: "确认提交" }));
    await waitFor(() => expect(client.createOrder).toHaveBeenCalledWith("a1", expect.objectContaining({ candidateId: "cand_a", expectedVersion: 2, quantity: 900, side: "buy" })));
  });

  it("uses refreshed watchlist data returned by advance without another request", async () => {
    window.__watchlistSeeded = false;
    const initial = { alias: "候选A", candidateId: "cand_a", detail: { boll: { justCrossedMiddle: true }, currentClose: 10, holding: null } };
    const advanced = { ...initial, detail: { ...initial.detail, currentClose: 11 } };
    const client = {
      advanceAccount: vi.fn().mockResolvedValue({
        candidateCount: 2,
        clock: { currentDate: "2026-07-02", nextDate: "2026-07-03" },
        id: "a1",
        status: "waiting_for_decision",
        version: 3,
        watchlistItems: [advanced],
      }),
      getWatchlist: vi.fn().mockResolvedValue({ items: [initial] }),
    };
    render(<MemoryRouter><SessionProvider client={client}><Seed><WatchlistPage /></Seed></SessionProvider></MemoryRouter>);
    await waitFor(() => expect(client.getWatchlist).toHaveBeenCalledTimes(1));
    const advanceButton = screen.getByRole("button", { name: "下一交易日" });
    fireEvent.click(advanceButton);
    fireEvent.click(advanceButton);
    await waitFor(() => expect(client.advanceAccount).toHaveBeenCalledTimes(1));
    expect(client.getWatchlist).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "操作候选A" }));
    expect(screen.getByText("查看走势")).toHaveAttribute("href", "/accounts/a1/stocks/cand_a");
  });

  it("opens stock detail when clicking a watchlist row", async () => {
    window.__watchlistSeeded = false;
    const item = { alias: "候选A", candidateId: "cand_a", detail: { boll: { justCrossedMiddle: true } } };
    const client = { getWatchlist: vi.fn().mockResolvedValue({ items: [item] }) };
    render(<MemoryRouter><SessionProvider client={client}><Seed><WatchlistPage /></Seed><LocationProbe /></SessionProvider></MemoryRouter>);
    fireEvent.click(await screen.findByRole("link", { name: "查看候选A详情" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/accounts/a1/stocks/cand_a");
  });
});
