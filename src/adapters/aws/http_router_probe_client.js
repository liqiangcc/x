"use strict";

function requiredEnv(env, name) {
  const value = String(env?.[name] ?? "").trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function appendUrlPath(baseUrl, pathname) {
  return `${String(baseUrl).replace(/\/+$/, "")}${pathname}`;
}

function createHttpRouterProbeClient({
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  return {
    async probe(body) {
      const routerUrl = requiredEnv(env, "AWS_ROUTER_URL");
      const routerToken = requiredEnv(env, "AWS_ROUTER_TOKEN");
      const response = await fetchImpl(appendUrlPath(routerUrl, "/probe"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-router-token": routerToken,
        },
        body: JSON.stringify(body),
      });
      const rawText = await response.text();
      let payload;
      try {
        payload = rawText ? JSON.parse(rawText) : {};
      } catch (error) {
        throw new Error(`Failed to parse Router response: ${error.message}`);
      }
      if (!response.ok || payload?.ok === false) {
        throw new Error(
          `Router returned statusCode ${response.status}: ${payload?.error ?? rawText}`
        );
      }
      return payload;
    },
  };
}

module.exports = {
  appendUrlPath,
  createHttpRouterProbeClient,
  requiredEnv,
};
