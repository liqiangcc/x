import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App.jsx";
import { MemoryRouter } from "react-router-dom";

describe("App", () => {
  it("renders the simulator shell", () => {
    render(<MemoryRouter initialEntries={["/accounts/new"]}><App /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "新建模拟账号" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "主导航" })).toBeInTheDocument();
  });

  it("routes to all primary simulator pages", () => {
    render(<MemoryRouter initialEntries={["/trade"]}><App /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "自选" })).toBeInTheDocument();
  });
});
