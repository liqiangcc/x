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
});
