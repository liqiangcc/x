import { useEffect } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SessionProvider, useSession } from "./SessionContext.jsx";

function Probe() {
  const { run, session, setSession } = useSession();
  useEffect(() => setSession({ clock: { currentDate: "2026-07-01" }, id: "account-1", version: 3 }), [setSession]);
  return <><span>{session?.id}</span><button onClick={() => run(() => Promise.resolve({ id: "strategy-1", version: 1 }))}>保存策略</button></>;
}

describe("SessionProvider", () => {
  it("does not replace the trading account with an unrelated versioned API response", async () => {
    render(<SessionProvider client={{}}><Probe /></SessionProvider>);
    await screen.findByText("account-1");
    fireEvent.click(screen.getByRole("button", { name: "保存策略" }));
    await waitFor(() => expect(screen.getByText("account-1")).toBeInTheDocument());
    expect(screen.queryByText("strategy-1")).not.toBeInTheDocument();
  });
});
