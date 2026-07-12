"use strict";

const { parseJsonOrJsonp } = require("../../core/jsonp");

const TARGET = "eastmoney-kline";
const ALLOWED_HOSTS = new Set(["push2his.eastmoney.com"]);
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145 Safari/537.36";

function buildKlineUrl({ secid = "1.600519", klt = 101, lmt = 1, end = "20991231" } = {}) {
  const url = new URL("https://push2his.eastmoney.com/api/qt/stock/kline/get");
  for (const [key, value] of Object.entries({ secid, ut: "fa5fd1943c7b386f172d6893dbfba10b", fields1: "f1,f2,f3,f4,f5,f6", fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61", klt, fqt: 1, end, lmt, _: Date.now() })) url.searchParams.set(key, String(value));
  return url.toString();
}

function createEastmoneyKlineProbe(input = {}) {
  const url = buildKlineUrl(input);
  if (!ALLOWED_HOSTS.has(new URL(url).hostname)) throw new Error("Eastmoney probe target is not allowed.");
  return {
    target: TARGET,
    request: {
      url,
      headers: { Accept: "*/*", "Accept-Language": "zh-CN,zh;q=0.9", Referer: "https://quote.eastmoney.com/", "User-Agent": USER_AGENT },
    },
    validate(response) {
      if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`Eastmoney proxy HTTP ${response.statusCode}: ${response.body.slice(0, 160)}`);
      let payload;
      try { payload = parseJsonOrJsonp(response.body); } catch (error) { throw new Error(`Eastmoney proxy returned invalid JSON: ${error.message}`); }
      if (!Array.isArray(payload?.data?.klines) || payload.data.klines.length === 0) throw new Error("Eastmoney proxy response missing data.klines or returned empty data.");
      return payload;
    },
  };
}

module.exports = { ALLOWED_HOSTS, TARGET, buildKlineUrl, createEastmoneyKlineProbe };
