import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import CreateSessionPage from "./CreateSessionPage.jsx";
import { SessionProvider } from "../state/SessionContext.jsx";

function renderPage(client) {
  return render(<MemoryRouter><SessionProvider client={client}><CreateSessionPage /></SessionProvider></MemoryRouter>);
}

describe("CreateSessionPage", () => {
  it("submits dates, money, mode and default selection", async () => {
    const client = { createSession: vi.fn().mockResolvedValue({ id: "s1", status: "waiting_for_decision", version: 1 }) };
    renderPage(client);
    fireEvent.change(screen.getByLabelText("练习模式"), { target: { value: "blind" } });
    fireEvent.click(screen.getByRole("button", { name: "开始匿名练习" }));
    await waitFor(() => expect(client.createSession).toHaveBeenCalled());
    expect(client.createSession.mock.calls[0][0]).toMatchObject({ initialCash: 100000, mode: "blind", selection: { limit: 20 } });
  });

  it("reports malformed advanced JSON without replacing valid config", () => {
    renderPage({ createSession: vi.fn() });
    fireEvent.click(screen.getByText("高级 JSON 配置"));
    fireEvent.change(screen.getByLabelText("候选 JSON 配置"), { target: { value: "{" } });
    expect(screen.getByRole("alert")).toHaveTextContent("JSON");
  });
});
