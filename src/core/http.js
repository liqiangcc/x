"use strict";

async function requestText(url, options = {}) {
  const retries = options.retries ?? 3;
  const timeoutMs = options.timeoutMs ?? 15000;
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: options.method ?? "GET",
        headers: options.headers ?? {},
        redirect: "follow",
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) => {
          setTimeout(resolve, attempt * 300);
        });
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}

module.exports = {
  requestText,
};
