import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import CreateSessionPage from "./CreateSessionPage.jsx";
import { SessionProvider } from "../state/SessionContext.jsx";

describe("CreateAccountPage", () => {
  it("creates a random-date account with initial cash", async () => {
    const client = { createAccount: vi.fn().mockResolvedValue({ clock: { currentDate: "2020-01-02" }, id: "a1", name: "练习账号", version: 1 }), getAccounts: vi.fn().mockResolvedValue({ accounts: [] }), getStrategies: vi.fn().mockResolvedValue({ strategies: [{ id: "system-year-decline-breakout", name: "默认", status: "ready" }] }) };
    render(<MemoryRouter><SessionProvider client={client}><CreateSessionPage /></SessionProvider></MemoryRouter>);
    const create = screen.getByRole("button", { name: "创建并开始" });
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);
    await waitFor(() => expect(client.createAccount).toHaveBeenCalled());
    expect(client.createAccount.mock.calls[0][0]).toMatchObject({ initialCash: 100000, startMode: "random" });
    expect(client.createAccount.mock.calls[0][0].startDate).toBeUndefined();
  });

  it("shows a date field for a specified start", () => {
    render(<MemoryRouter><SessionProvider client={{ createAccount: vi.fn(), getAccounts: vi.fn().mockResolvedValue({ accounts: [] }), getStrategies: vi.fn().mockResolvedValue({ strategies: [] }) }}><CreateSessionPage /></SessionProvider></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("开始方式"), { target: { value: "specified" } });
    expect(screen.getByLabelText("开始日期")).toBeInTheDocument();
  });
});
