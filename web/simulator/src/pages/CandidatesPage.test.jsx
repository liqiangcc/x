import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import CandidatesPage, { priceAscending } from "./CandidatesPage.jsx";
import { SessionProvider, useSession } from "../state/SessionContext.jsx";

function Seed({ children }) {
  const { setSession } = useSession();
  useEffect(() => {
    setSession({ clock: { currentDate: "2026-07-01" }, id: "a1", status: "waiting_for_decision", strategyId: "default", version: 1 });
  }, [setSession]);
  return children;
}

function renderPage(client) {
  return render(<MemoryRouter><SessionProvider client={client}><Seed><CandidatesPage /></Seed></SessionProvider></MemoryRouter>);
}

describe("CandidatesPage", () => {
  it("automatically queries indexed candidates and supports bulk watchlist add", async () => {
    const candidate = { alias: "候选A", candidateId: "cand_a", evidence: { breakout_margin_pct: 1.2, previous_year_high: 17 }, qualityIssues: [], rank: 1 };
    const client = {
      addWatchlistBulk: vi.fn().mockResolvedValue({}),
      calculateCandidates: vi.fn(),
      getAccountCandidates: vi.fn().mockResolvedValue({ calculated: true, pagination: { items: [candidate], total: 1 } }),
      getStrategies: vi.fn().mockResolvedValue({ strategies: [{ id: "default", name: "默认", status: "ready" }] }),
    };
    renderPage(client);
    expect(await screen.findByRole("heading", { name: "候选A" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "计算当前日期" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "全部加入自选" }));
    await waitFor(() => expect(client.addWatchlistBulk).toHaveBeenCalledWith("a1", ["cand_a"]));
  });

  it("sorts candidates by current price from low to high", () => {
    const items = [
      { candidateId: "high", evidence: { today_close: 20 } },
      { candidateId: "missing", evidence: {} },
      { candidateId: "low", evidence: { today_close: 5 } },
    ];
    expect([...items].sort(priceAscending).map((item) => item.candidateId)).toEqual(["low", "high", "missing"]);
  });
});
