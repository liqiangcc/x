import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "./client.js";

describe("API client", () => {
  it("serializes writes and exposes structured API errors", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({ error: { code: "session_version_conflict", issues: [], message: "冲突" } }),
      ok: false,
      status: 409,
    });
    const client = createApiClient({ fetchImpl });
    await expect(client.advance("session-a", 2)).rejects.toMatchObject({ code: "session_version_conflict", status: 409 });
    expect(fetchImpl).toHaveBeenCalledWith("/api/sessions/session-a/advance", expect.objectContaining({ body: JSON.stringify({ expectedVersion: 2 }), method: "POST" }));
    expect(ApiError.prototype).toBeInstanceOf(Error);
  });

  it("coalesces repeated account advances for the same version", async () => {
    let resolveFetch;
    const fetchImpl = vi.fn().mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));
    const client = createApiClient({ fetchImpl });
    const first = client.advanceAccount("account-a", 7);
    const second = client.advanceAccount("account-a", 7);
    expect(second).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    resolveFetch({ json: async () => ({ id: "account-a", version: 9 }), ok: true, status: 200 });
    await Promise.all([first, second]);
  });

  it("coalesces repeated order submissions for the same session version", async () => {
    let resolveFetch;
    const fetchImpl = vi.fn().mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));
    const client = createApiClient({ fetchImpl });
    const body = { candidateId: "candidate-a", expectedVersion: 8, quantity: 100, reason: "突破", side: "buy" };
    const first = client.createOrder("account-a", body);
    const second = client.createOrder("account-a", body);
    expect(second).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    resolveFetch({ json: async () => ({ order: { id: "order-a" }, sessionVersion: 9 }), ok: true, status: 201 });
    await Promise.all([first, second]);
  });

  it("sends an explicit JSON object for strategy sync POST requests", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ json: async () => ({ job: { status: "queued" } }), ok: true, status: 202 });
    const client = createApiClient({ fetchImpl });
    await client.startStrategySync("strategy-a");
    expect(fetchImpl).toHaveBeenCalledWith("/api/strategies/strategy-a/sync", expect.objectContaining({
      body: "{}",
      headers: expect.objectContaining({ "content-type": "application/json" }),
      method: "POST",
    }));
  });

  it("queries paginated data status details on demand", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ json: async () => ({ items: [] }), ok: true, status: 200 });
    const client = createApiClient({ fetchImpl });
    await client.getDataStatusDetails({ category: "date", date: "2026-07-13", page: 2, pageSize: 50, period: "daily" });
    expect(fetchImpl).toHaveBeenCalledWith("/api/data/status/details?category=date&page=2&pageSize=50&period=daily&date=2026-07-13", expect.any(Object));
  });

  it("loads a raw-data stock chart by code", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ json: async () => ({ daily: [] }), ok: true, status: 200 });
    const client = createApiClient({ fetchImpl });
    await client.getDataStockChart("600001");
    expect(fetchImpl).toHaveBeenCalledWith("/api/data/stocks/600001/chart", expect.any(Object));
  });

  it("supports strategy builder catalog, validation, and custom template CRUD", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ json: async () => ({}), ok: true, status: 200 });
    const client = createApiClient({ fetchImpl });
    await client.getStrategyBuilderCatalog();
    await client.getStrategyTemplates();
    await client.validateStrategy({ rules: [] });
    await client.createStrategyTemplate({ definition: {}, name: "模板" });
    await client.updateStrategyTemplate("template-a", { definition: {}, name: "新版" });
    await client.deleteStrategyTemplate("template-a");
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "/api/strategy-builder/catalog",
      "/api/strategy-templates",
      "/api/strategies/validate",
      "/api/strategy-templates",
      "/api/strategy-templates/template-a",
      "/api/strategy-templates/template-a",
    ]);
  });
});
