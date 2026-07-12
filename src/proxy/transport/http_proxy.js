"use strict";

const { ProxyAgent, request } = require("undici");

async function requestThroughProxy(proxy, requestOptions, deps = {}) {
  const endpoint = typeof proxy === "string" ? proxy : proxy.endpoint;
  const protocol = typeof proxy === "string" ? "http" : proxy.protocol ?? "http";
  const timeoutMs = requestOptions.timeoutMs ?? 6000;
  const proxyAgentFactory = deps.proxyAgentFactory ?? ((config) => new ProxyAgent(config));
  const requestImpl = deps.requestImpl ?? request;
  const ownedDispatcher = !deps.dispatcher;
  const dispatcher = deps.dispatcher ?? proxyAgentFactory({
    uri: `${protocol}://${endpoint}`,
    proxyTls: { timeout: timeoutMs },
    requestTls: { rejectUnauthorized: true, timeout: timeoutMs },
  });
  const startedAt = Date.now();
  try {
    const response = await requestImpl(requestOptions.url, {
      dispatcher,
      headers: requestOptions.headers ?? {},
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
      maxRedirections: requestOptions.maxRedirections ?? 0,
      method: requestOptions.method ?? "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return {
      body: await response.body.text(),
      durationMs: Date.now() - startedAt,
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
    const timeoutMs = requestOptions.timeoutMs ?? 6000;
    let dispatcher = this.agents.get(endpoint);
    if (!dispatcher) {
      dispatcher = this.proxyAgentFactory({
        uri: `${protocol}://${endpoint}`,
        proxyTls: { timeout: timeoutMs },
        requestTls: { rejectUnauthorized: true, timeout: timeoutMs },
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
