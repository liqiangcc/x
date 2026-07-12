"use strict";

const { ProxyAgent, request } = require("undici");

async function boundedDestroy(dispatcher, timeoutMs = 500) {
  if (!dispatcher) return;
  await Promise.race([
    Promise.resolve().then(() => dispatcher.destroy()).catch(() => {}),
    new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
    }),
  ]);
}

async function withHardDeadline(callback, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      callback(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Proxy request hard deadline exceeded after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
    return await withHardDeadline(async () => {
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
    }, totalTimeoutMs);
  } finally {
    if (ownedDispatcher) await boundedDestroy(dispatcher);
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
      await boundedDestroy(dispatcher);
      throw error;
    }
  }

  async close() {
    await Promise.allSettled([...this.agents.values()].map((agent) => boundedDestroy(agent)));
    this.agents.clear();
  }
}

module.exports = { ProxyTransportSession, boundedDestroy, requestThroughProxy, withHardDeadline };
