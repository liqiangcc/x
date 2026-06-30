"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { requestText } = require("../../core/http");
const { parseJsonOrJsonp } = require("../../core/jsonp");

const ROOT = path.resolve(__dirname, "../../..");
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 Edg/145.0.0.0";
const POOLS = new Set(["dt", "qs", "zb", "zt"]);

function defaultHeaders(referer = "https://quote.eastmoney.com/") {
  return {
    Accept: "*/*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
    Connection: "keep-alive",
    Referer: referer,
    "User-Agent": USER_AGENT,
  };
}

function parseCurlTemplate(commandText) {
  const lines = commandText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (line.endsWith("\\") ? line.slice(0, -1).trimEnd() : line));

  const firstLine = lines[0];
  const urlMatch = firstLine?.match(/^curl\s+'([^']+)'$/);
  if (!urlMatch) {
    throw new Error("Curl template does not contain a parsable URL.");
  }

  const headers = {};
  for (const line of lines.slice(1)) {
    const headerMatch = line.match(/^-H\s+'([^:]+):\s*(.*)'$/);
    if (headerMatch) {
      const [, name, value] = headerMatch;
      headers[name] = value;
      continue;
    }

    const cookieMatch = line.match(/^-b\s+'(.*)'$/);
    if (cookieMatch) {
      headers.Cookie = cookieMatch[1];
    }
  }

  return { url: urlMatch[1], headers };
}

async function buildPoolRequest(pool, dateValue) {
  if (!POOLS.has(pool)) {
    throw new Error(`Invalid pool: ${pool}`);
  }

  const templatePath = path.join(ROOT, `curl_${pool}.txt`);
  const template = await fs.readFile(templatePath, "utf8");
  const { url, headers } = parseCurlTemplate(template);
  const parsedUrl = new URL(url);
  const timestamp = Date.now().toString();

  parsedUrl.searchParams.set("date", dateValue);
  if (parsedUrl.searchParams.has("cb")) {
    parsedUrl.searchParams.set("cb", `callbackdata${timestamp}`);
  }
  if (parsedUrl.searchParams.has("_")) {
    parsedUrl.searchParams.set("_", timestamp);
  }

  return {
    commandText: `curl '${parsedUrl.toString()}'`,
    headers,
    url: parsedUrl.toString(),
  };
}

async function fetchPool(pool, dateValue) {
  const request = await buildPoolRequest(pool, dateValue);
  const rawText = await requestText(request.url, { headers: request.headers });
  return parseJsonOrJsonp(rawText);
}

async function getKline({ secid, klt, lmt = 100000, end = "20991231" }) {
  const url = new URL("https://push2his.eastmoney.com/api/qt/stock/kline/get");
  url.searchParams.set("secid", secid);
  url.searchParams.set("ut", "fa5fd1943c7b386f172d6893dbfba10b");
  url.searchParams.set("fields1", "f1,f2,f3,f4,f5,f6");
  url.searchParams.set("fields2", "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61");
  url.searchParams.set("klt", String(klt));
  url.searchParams.set("fqt", "1");
  url.searchParams.set("end", String(end));
  url.searchParams.set("lmt", String(lmt));
  url.searchParams.set("_", String(Date.now()));

  const rawText = await requestText(url.toString(), {
    headers: defaultHeaders("https://quote.eastmoney.com/"),
  });
  return parseJsonOrJsonp(rawText);
}

async function requestJson(url, referer) {
  const rawText = await requestText(url, { headers: defaultHeaders(referer) });
  return parseJsonOrJsonp(rawText);
}

async function getSectors(page = 1, pageSize = 100) {
  const fields = "f12%2Cf13%2Cf14%2Cf1%2Cf2%2Cf4%2Cf3%2Cf152%2Cf20%2Cf8%2Cf104%2Cf105%2Cf128%2Cf140%2Cf141%2Cf207%2Cf208%2Cf209%2Cf136%2Cf222";
  const url = `https://push2.eastmoney.com/api/qt/clist/get?np=1&fltt=1&invt=2&cb=cb&fs=m%3A90%2Bt%3A2%2Bf%3A%2150&po=1&ut=fa5fd1943c7b386f172d6893dbfba10b&fields=${fields}&pn=${page}&pz=${pageSize}`;
  return requestJson(url, "https://quote.eastmoney.com/center/gridlist.html");
}

async function getStocks(sectorCode, page = 1, pageSize = 100) {
  const fields = "f12%2Cf14%2Cf2%2Cf3%2Cf62%2Cf184%2Cf66%2Cf69%2Cf72%2Cf75%2Cf78%2Cf81%2Cf84%2Cf87%2Cf204%2Cf205%2Cf124%2Cf1%2Cf13";
  const url = `https://push2delay.eastmoney.com/api/qt/clist/get?cb=cb&fid=f62&po=1&np=1&fltt=2&invt=2&ut=8dec03ba335b81bf4ebdf7b29ec27d15&fs=b%3A${sectorCode}&fields=${fields}&pn=${page}&pz=${pageSize}`;
  return requestJson(url, `https://data.eastmoney.com/bkzj/${sectorCode}.html`);
}

async function fetchAllPages(fetchPage, dataPath = ["data", "diff"]) {
  let page = 1;
  let base = null;
  const combined = [];

  while (true) {
    const payload = await fetchPage(page);
    if (!base) {
      base = payload;
    }

    const pageItems = dataPath.reduce((value, key) => value?.[key], payload);
    if (!Array.isArray(pageItems) || pageItems.length === 0) {
      break;
    }
    combined.push(...pageItems);

    const total = Number(payload?.data?.total ?? payload?.result?.count ?? combined.length);
    if (combined.length >= total) {
      break;
    }
    page += 1;
  }

  return { base, combined };
}

async function getAllSectors() {
  const { base, combined } = await fetchAllPages((page) => getSectors(page));
  return {
    ...base,
    data: {
      ...(base?.data ?? {}),
      diff: combined,
      total: combined.length,
    },
  };
}

async function getAllStocks(sectorCode) {
  const { base, combined } = await fetchAllPages((page) => getStocks(sectorCode, page));
  return {
    ...base,
    data: {
      ...(base?.data ?? {}),
      diff: combined,
      total: combined.length,
    },
  };
}

async function getEtfs(page = 1, pageSize = 5000) {
  const url = `https://datacenter.eastmoney.com/stock/fundselector/api/data/get?type=RPTA_APP_FUNDSELECT&sty=ETF_TYPE_CODE,SECUCODE,SECURITY_CODE,CHANGE_RATE_1W,CHANGE_RATE_1M,CHANGE_RATE_3M,YTD_CHANGE_RATE,DEC_TOTALSHARE,DEC_NAV,SECURITY_NAME_ABBR,DERIVE_INDEX_CODE,INDEX_CODE,INDEX_NAME,NEW_PRICE,CHANGE_RATE,CHANGE,VOLUME,DEAL_AMOUNT,PREMIUM_DISCOUNT_RATIO,QUANTITY_RELATIVE_RATIO,HIGH_PRICE,LOW_PRICE,STOCK_ID,PRE_CLOSE_PRICE&source=FUND_SELECTOR&client=APP&sr=-1,-1,1&st=CHANGE_RATE,CHANGE,SECURITY_CODE&filter=(ETF_TYPE_CODE%3D%22ALL%22)&p=${page}&ps=${pageSize}`;
  return requestJson(url, "https://fund.eastmoney.com/");
}

async function getAllEtfs() {
  const first = await getEtfs(1);
  const totalPages = Number(first?.result?.pages ?? 1);
  const combined = Array.isArray(first?.result?.data) ? [...first.result.data] : [];

  for (let page = 2; page <= totalPages; page += 1) {
    const payload = await getEtfs(page);
    if (Array.isArray(payload?.result?.data)) {
      combined.push(...payload.result.data);
    }
  }

  return {
    result: {
      ...(first?.result ?? {}),
      data: combined,
      count: combined.length,
    },
  };
}

async function getEtfDetails(fundCode) {
  const url = `https://fund.eastmoney.com/${fundCode}.html`;
  const html = await requestText(url, {
    headers: defaultHeaders("https://fund.eastmoney.com/"),
  });

  const pick = (regex, fallback = "") => {
    const match = html.match(regex);
    return match ? match[1].trim() : fallback;
  };

  const title = html.match(/<title>(.*)\((\d{6})\).*<\/title>/);
  return {
    name: title ? title[1].trim() : "",
    code: title ? title[2].trim() : fundCode,
    scale: pick(/规模<\/a>：(.*?)亿元/),
    establishment_date: pick(/成 立 日<\/span>：(.*?)<\/td>/),
    type: pick(/类型：<a .*?>(.*?)<\/a>/),
    fund_manager: pick(/基金经理：<a .*?>(.*?)<\/a>(.*?)<\/td>/).replace(/<[^>]+>/g, ""),
    management_company: pick(/管 理 人<\/span>：<a .*?>(.*?)<\/a>/),
    fund_rating: pick(/<div class="jjpj">(.*?)<\/div>/).replace(/<[^>]+>/g, ""),
  };
}

module.exports = {
  buildPoolRequest,
  fetchPool,
  getAllEtfs,
  getAllSectors,
  getAllStocks,
  getEtfDetails,
  getEtfs,
  getKline,
  getSectors,
  getStocks,
};
