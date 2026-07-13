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
  const inFlight = new Map();

  function deduplicate(key, action) {
    const existing = inFlight.get(key);
    if (existing) return existing;
    const pending = action().finally(() => {
      if (inFlight.get(key) === pending) inFlight.delete(key);
    });
    inFlight.set(key, pending);
    return pending;
  }

  async function request(path, options = {}) {
    const headers = { ...options.headers };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    const response = await fetchImpl(`${prefix}${path}`, {
      ...options,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const payload = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new ApiError(payload, response.status);
    return payload;
  }

  return {
    createAccount: (body) => request("/accounts", { body, method: "POST" }),
    getAccounts: () => request("/accounts"),
    getAccount: (accountId) => request(`/accounts/${accountId}`),
    advanceAccount: (accountId, expectedVersion) => deduplicate(
      `advance-account:${accountId}:${expectedVersion}`,
      () => request(`/accounts/${accountId}/advance`, { body: { expectedVersion }, method: "POST" })
    ),
    calculateCandidates: (accountId, body) => request(`/accounts/${accountId}/candidate-calculations`, { body, method: "POST" }),
    getAccountCandidates: (accountId, query = "") => request(`/accounts/${accountId}/candidates${query}`),
    getStrategies: () => request("/strategies"),
    getDataStatus: (refresh = false) => request(`/data/status${refresh ? "?refresh=true" : ""}`),
    getStrategyBuild: (strategyId) => request(`/strategies/${strategyId}/build`),
    rebuildStrategy: (strategyId) => request(`/strategies/${strategyId}/rebuild`, { method: "POST" }),
    createStrategy: (body) => request("/strategies", { body, method: "POST" }),
    updateStrategy: (strategyId, body) => request(`/strategies/${strategyId}`, { body, method: "PUT" }),
    deleteStrategy: (strategyId) => request(`/strategies/${strategyId}`, { method: "DELETE" }),
    getWatchlist: (accountId) => request(`/accounts/${accountId}/watchlist`),
    addWatchlist: (accountId, candidateId) => request(`/accounts/${accountId}/watchlist`, { body: { candidateId }, method: "POST" }),
    addWatchlistBulk: (accountId, candidateIds) => request(`/accounts/${accountId}/watchlist/bulk`, { body: { candidateIds }, method: "POST" }),
    removeWatchlist: (accountId, candidateId) => request(`/accounts/${accountId}/watchlist/${candidateId}`, { method: "DELETE" }),
    getStockChart: (accountId, candidateId) => request(`/accounts/${accountId}/stocks/${candidateId}/chart`),
    advance: (sessionId, expectedVersion) => request(`/sessions/${sessionId}/advance`, { body: { expectedVersion }, method: "POST" }),
    skip: (sessionId, expectedVersion) => request(`/sessions/${sessionId}/skip`, { body: { expectedVersion }, method: "POST" }),
    completeDecision: (sessionId, expectedVersion) => request(`/sessions/${sessionId}/complete-decision`, { body: { expectedVersion }, method: "POST" }),
    createOrder: (sessionId, body) => deduplicate(
      `create-order:${sessionId}:${body.expectedVersion}`,
      () => request(`/sessions/${sessionId}/orders`, { body, method: "POST" })
    ),
    updateOrder: (sessionId, orderId, body) => request(`/sessions/${sessionId}/orders/${orderId}`, { body, method: "PATCH" }),
    cancelOrder: (sessionId, orderId, expectedVersion) => request(`/sessions/${sessionId}/orders/${orderId}`, { body: { expectedVersion }, method: "DELETE" }),
    createSession: (body) => request("/sessions", { body, method: "POST" }),
    getCandidates: (sessionId, query = "") => request(`/sessions/${sessionId}/candidates${query}`),
    getChart: (sessionId, candidateId) => request(`/sessions/${sessionId}/chart/${candidateId}`),
    getPortfolio: (sessionId) => request(`/sessions/${sessionId}/portfolio`),
    getSession: (sessionId) => request(`/sessions/${sessionId}`),
    getOrders: (sessionId, query = "") => request(`/sessions/${sessionId}/orders${query}`),
    getFills: (sessionId, query = "") => request(`/sessions/${sessionId}/fills${query}`),
    getReport: (sessionId) => request(`/sessions/${sessionId}/report`),
    finish: (sessionId, expectedVersion) => request(`/sessions/${sessionId}/finish`, { body: { expectedVersion }, method: "POST" }),
    exportSession: (sessionId) => request(`/sessions/${sessionId}/export`, { method: "POST" }),
    cloneSession: (sessionId, body) => request(`/sessions/${sessionId}/clone`, { body, method: "POST" }),
    reveal: (sessionId, expectedVersion) => request(`/sessions/${sessionId}/reveal`, { body: { expectedVersion }, method: "POST" }),
  };
}

export const api = createApiClient();
