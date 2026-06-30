"use strict";

function inferSecid(input) {
  const value = String(input);
  if (/^\d+\.[A-Za-z0-9]+$/.test(value)) {
    return value;
  }
  if (/^6\d{5}$/.test(value)) {
    return `1.${value}`;
  }
  if (/^[03]\d{5}$/.test(value)) {
    return `0.${value}`;
  }
  if (/^9\d{5}$/.test(value)) {
    return `0.${value}`;
  }
  throw new Error(`Unable to infer secid from input: ${input}`);
}

function splitSecid(secid) {
  const normalized = inferSecid(secid);
  const [market, code] = normalized.split(".");
  return {
    market: Number(market),
    code,
    secid: normalized,
  };
}

module.exports = {
  inferSecid,
  splitSecid,
};
