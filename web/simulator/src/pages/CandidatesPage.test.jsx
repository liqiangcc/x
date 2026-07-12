import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import CandidatesPage from "./CandidatesPage.jsx";
import { SessionProvider, useSession } from "../state/SessionContext.jsx";

function Seed({ children }) {
  const { setSession } = useSession();
  if (!window.__seeded) {
    window.__seeded = true;
    queueMicrotask(() => setSession({ clock: { currentDate: "2026-07-01" }, config: { selection: {} }, id: "s1", mode: "manual", status: "waiting_for_decision", version: 1 }));
  }
  return children;
}

function renderPage(client) {
  window.__seeded = false;
  return render(<MemoryRouter><SessionProvider client={client}><Seed><CandidatesPage /></Seed></SessionProvider></MemoryRouter>);
}

describe("CandidatesPage", () => {
  it("shows anonymous evidence and opens a candidate without identity", async () => {
    const client = { getCandidates: vi.fn().mockResolvedValue({ pagination: { items: [{ alias: "候选A", candidateId: "cand_a", evidence: { breakout_margin_pct: 1.2, previous_year_high: 17 }, qualityIssues: [], rank: 1 }], total: 1, totalPages: 1 } }) };
    renderPage(client);
    expect(await screen.findByRole("heading", { name: "候选A" })).toBeInTheDocument();
    expect(screen.getByText("1.20%" )).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("600001");
  });

  it("offers reveal only in ordinary anonymous mode", async () => {
    const client = { getCandidates: vi.fn().mockResolvedValue({ pagination: { items: [], total: 0, totalPages: 0 } }), reveal: vi.fn().mockResolvedValue({ identities: [], revealedAt: "now", sessionVersion: 2 }) };
    renderPage(client);
    const [button] = await screen.findAllByRole("button", { name: "显式揭晓身份" });
    fireEvent.click(button);
    await waitFor(() => expect(client.reveal).toHaveBeenCalledWith("s1", 1));
  });
});
