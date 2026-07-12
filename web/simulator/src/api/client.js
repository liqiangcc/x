export class ApiError extends Error {
  constructor(payload, status) {
    super(payload?.error?.message ?? "请求失败");
    this.name = "ApiError";
    this.code = payload?.error?.code ?? "request_failed";
    this.issues = payload?.error?.issues ?? [];
    this.status = status;
  }
}

export function createApiClient({ fetchImpl = fetch, prefix = "/api" } = {}) {
  async function request(path, options = {}) {
    const response = await fetchImpl(`${prefix}${path}`, {
      ...options,
      headers: { "content-type": "application/json", ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const payload = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new ApiError(payload, response.status);
    return payload;
  }

  return {
    advance: (sessionId, expectedVersion) => request(`/sessions/${sessionId}/advance`, { body: { expectedVersion }, method: "POST" }),
    completeDecision: (sessionId, expectedVersion) => request(`/sessions/${sessionId}/complete-decision`, { body: { expectedVersion }, method: "POST" }),
    createOrder: (sessionId, body) => request(`/sessions/${sessionId}/orders`, { body, method: "POST" }),
    createSession: (body) => request("/sessions", { body, method: "POST" }),
    getCandidates: (sessionId, query = "") => request(`/sessions/${sessionId}/candidates${query}`),
    getChart: (sessionId, candidateId) => request(`/sessions/${sessionId}/chart/${candidateId}`),
    getPortfolio: (sessionId) => request(`/sessions/${sessionId}/portfolio`),
    getReport: (sessionId) => request(`/sessions/${sessionId}/report`),
    cloneSession: (sessionId, body) => request(`/sessions/${sessionId}/clone`, { body, method: "POST" }),
    reveal: (sessionId, expectedVersion) => request(`/sessions/${sessionId}/reveal`, { body: { expectedVersion }, method: "POST" }),
  };
}

export const api = createApiClient();
