import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App.jsx";

describe("App", () => {
  it("renders the simulator shell", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "历史交易练习" })).toBeInTheDocument();
  });
});
