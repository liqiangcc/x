"use strict";

const { ProxyAgent, request } = require("undici");

async function requestThroughProxy(proxy, requestOptions, deps = {}) {
  const endpoint = typeof proxy === "string" ? proxy : proxy.endpoint;
  const protocol = typeof proxy === "string" ? "http" : proxy.protocol ?? "http";
  const timeoutMs = requestOptions.timeoutMs ?? 6000;
  const proxyAgentFactory = deps.proxyAgentFactory ?? ((config) => new ProxyAgent(config));
  const requestImpl = deps.requestImpl ?? request;
  const dispatcher = proxyAgentFactory({
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
    await dispatcher.destroy();
  }
}

module.exports = { requestThroughProxy };
