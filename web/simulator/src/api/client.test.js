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
});
