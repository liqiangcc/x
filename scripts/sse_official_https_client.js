"use strict";

const dns = require("node:dns");
const https = require("node:https");

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 5;

dns.setDefaultResultOrder("ipv4first");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertOfficialSseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new TypeError("SSE discovery URL must use HTTPS.");
  }
  const host = url.hostname.toLowerCase();
  if (!(host === "sse.com.cn" || host.endsWith(".sse.com.cn"))) {
    throw new TypeError(`SSE discovery URL must belong to sse.com.cn, got ${host}.`);
  }
  return url;
}

function requestOnce(url, { referer, timeoutMs, redirectsLeft }) {
  const target = assertOfficialSseUrl(url);
  return new Promise((resolve, reject) => {
    const request = https.request(target, {
      method: "GET",
      family: 4,
      headers: {
        accept: "*/*",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        referer,
        "user-agent": "Mozilla/5.0 (X Security Master source verification; +https://github.com/liqiangcc/x)",
      },
    }, (response) => {
      const status = Number(response.statusCode ?? 0);
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
        response.resume();
        if (redirectsLeft <= 0) {
          reject(new Error(`GET ${target.href} exceeded ${MAX_REDIRECTS} redirects.`));
          return;
        }
        let redirected;
        try {
          redirected = assertOfficialSseUrl(new URL(location, target).href);
        } catch (error) {
          reject(error);
          return;
        }
        requestOnce(redirected, {
          referer: target.href,
          timeoutMs,
          redirectsLeft: redirectsLeft - 1,
        }).then(resolve, reject);
        return;
      }

      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => {
        const buffer = Buffer.concat(chunks);
        if (status < 200 || status >= 300) {
          reject(new Error(`GET ${target.href} failed with HTTP ${status}.`));
          return;
        }
        resolve({
          url: target.href,
          status,
          contentType: response.headers["content-type"] ?? null,
          contentDisposition: response.headers["content-disposition"] ?? null,
          buffer,
        });
      });
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`GET ${target.href} timed out after ${timeoutMs}ms.`));
    });
    request.on("error", reject);
    request.end();
  });
}

async function fetchOfficialSse(url, {
  referer = "https://etf.sse.com.cn/fundlist/",
  attempts = DEFAULT_ATTEMPTS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  assertOfficialSseUrl(referer);
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await requestOnce(url, {
        referer,
        timeoutMs,
        redirectsLeft: MAX_REDIRECTS,
      });
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await delay(500 * attempt);
    }
  }
  throw new Error(
    `GET ${assertOfficialSseUrl(url).href} failed after ${attempts} attempts: ${lastError?.message ?? "unknown error"}`,
    { cause: lastError }
  );
}

module.exports = {
  DEFAULT_ATTEMPTS,
  DEFAULT_TIMEOUT_MS,
  MAX_REDIRECTS,
  assertOfficialSseUrl,
  fetchOfficialSse,
};
