"use strict";

const { ProxyAgent, request } = require("undici");

async function requestThroughProxy(proxy, requestOptions, deps = {}) {
  const endpoint = typeof proxy === "string" ? proxy : proxy.endpoint;
  const protocol = typeof proxy === "string" ? "http" : proxy.protocol ?? "http";
  const connectTimeoutMs = requestOptions.connectTimeoutMs ?? 2000;
  const headersTimeoutMs = requestOptions.headersTimeoutMs ?? requestOptions.timeoutMs ?? 3000;
  const bodyTimeoutMs = requestOptions.bodyTimeoutMs ?? 3000;
  const totalTimeoutMs = requestOptions.totalTimeoutMs ?? 10000;
  const proxyAgentFactory = deps.proxyAgentFactory ?? ((config) => new ProxyAgent(config));
  const requestImpl = deps.requestImpl ?? request;
  const ownedDispatcher = !deps.dispatcher;
  const dispatcher = deps.dispatcher ?? proxyAgentFactory({
    uri: `${protocol}://${endpoint}`,
    proxyTls: { timeout: connectTimeoutMs },
    requestTls: { rejectUnauthorized: true, timeout: connectTimeoutMs },
  });
  const startedAt = Date.now();
  try {
    const response = await requestImpl(requestOptions.url, {
      dispatcher,
      headers: requestOptions.headers ?? {},
      headersTimeout: headersTimeoutMs,
      bodyTimeout: bodyTimeoutMs,
      maxRedirections: requestOptions.maxRedirections ?? 0,
      method: requestOptions.method ?? "GET",
      signal: AbortSignal.timeout(totalTimeoutMs),
    });
    const headersDurationMs = Date.now() - startedAt;
    const body = await response.body.text();
    return {
      body,
      bodyDurationMs: Date.now() - startedAt - headersDurationMs,
      durationMs: Date.now() - startedAt,
      headersDurationMs,
      statusCode: response.statusCode,
    };
  } finally {
    if (ownedDispatcher) await dispatcher.destroy();
  }
}

class ProxyTransportSession {
  constructor(deps = {}) {
    this.agents = new Map();
    this.proxyAgentFactory = deps.proxyAgentFactory ?? ((config) => new ProxyAgent(config));
    this.requestImpl = deps.requestImpl ?? request;
  }

  async request(proxy, requestOptions) {
    const endpoint = typeof proxy === "string" ? proxy : proxy.endpoint;
    const protocol = typeof proxy === "string" ? "http" : proxy.protocol ?? "http";
    const connectTimeoutMs = requestOptions.connectTimeoutMs ?? 2000;
    let dispatcher = this.agents.get(endpoint);
    if (!dispatcher) {
      dispatcher = this.proxyAgentFactory({
        uri: `${protocol}://${endpoint}`,
        proxyTls: { timeout: connectTimeoutMs },
        requestTls: { rejectUnauthorized: true, timeout: connectTimeoutMs },
      });
      this.agents.set(endpoint, dispatcher);
    }
    try {
      return await requestThroughProxy(proxy, requestOptions, { dispatcher, requestImpl: this.requestImpl });
    } catch (error) {
      this.agents.delete(endpoint);
      await dispatcher.destroy();
      throw error;
    }
  }

  async close() {
    await Promise.allSettled([...this.agents.values()].map((agent) => agent.destroy()));
    this.agents.clear();
  }
}

module.exports = { ProxyTransportSession, requestThroughProxy };
