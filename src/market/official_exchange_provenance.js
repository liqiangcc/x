"use strict";

const OFFICIAL_EXCHANGE_HOST_SUFFIXES = Object.freeze({
  sse: "sse.com.cn",
  szse: "szse.cn",
});

function normalizeOfficialExchange(value) {
  const exchange = String(value ?? "").trim().toLowerCase();
  if (!Object.hasOwn(OFFICIAL_EXCHANGE_HOST_SUFFIXES, exchange)) {
    throw new TypeError("exchange must be one of: sse, szse.");
  }
  return exchange;
}

function requiredText(value, field) {
  const text = String(value ?? "").trim();
  if (!text) throw new TypeError(`${field} must be a non-empty string.`);
  return text;
}

function assertOfficialExchangeDocument(exchangeValue, value, field = "source.document") {
  const exchange = normalizeOfficialExchange(exchangeValue);
  const document = requiredText(value, field);
  let url;
  try {
    url = new URL(document);
  } catch {
    throw new TypeError(`${field} must be an absolute official exchange URL.`);
  }
  if (url.protocol !== "https:") {
    throw new TypeError(`${field} must use https.`);
  }
  const suffix = OFFICIAL_EXCHANGE_HOST_SUFFIXES[exchange];
  const hostname = url.hostname.toLowerCase();
  if (hostname !== suffix && !hostname.endsWith(`.${suffix}`)) {
    throw new TypeError(`${field} must belong to ${suffix}.`);
  }
  return url.toString();
}

module.exports = {
  OFFICIAL_EXCHANGE_HOST_SUFFIXES,
  assertOfficialExchangeDocument,
  normalizeOfficialExchange,
};
