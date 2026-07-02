"use strict";

const http = require("node:http");
const https = require("node:https");

function requestTextOnce(urlText, options, timeoutMs, redirectsRemaining = 5) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlText);
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(url, {
      agent: false,
      headers: options.headers ?? {},
      method: options.method ?? "GET",
      timeout: timeoutMs,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => {
        chunks.push(Buffer.from(chunk));
      });
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location &&
          redirectsRemaining > 0
        ) {
          resolve(requestTextOnce(new URL(response.headers.location, url).toString(), options, timeoutMs, redirectsRemaining - 1));
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode} ${response.statusMessage ?? ""}`.trim()));
          return;
        }
        resolve(text);
      });
    });
    request.on("timeout", () => {
      request.destroy(new Error("Request timeout."));
    });
    request.on("error", reject);
    request.end();
  });
}

async function requestText(url, options = {}) {
  const retries = options.retries ?? 3;
  const timeoutMs = options.timeoutMs ?? 15000;
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await requestTextOnce(url, options, timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) => {
          setTimeout(resolve, attempt * 300);
        });
      }
    }
  }

  throw lastError;
}

module.exports = {
  requestText,
};
