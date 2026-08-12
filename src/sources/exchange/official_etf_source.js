"use strict";

const {
  normalizeCollectedAt,
} = require("../../market/security_master_record");
const {
  normalizeEtfSecurityFact,
  normalizeExchange,
} = require("../../market/etf_security_fact_normalizer");
const {
  assertEtfSecuritySource,
} = require("../../ports/market/etf_security_source");

const EXCHANGE_MARKETS = Object.freeze({
  sse: 1,
  szse: 0,
});
const OFFICIAL_HOST_SUFFIXES = Object.freeze({
  sse: "sse.com.cn",
  szse: "szse.cn",
});

function requiredText(value, field) {
  const text = String(value ?? "").trim();
  if (!text) throw new TypeError(`${field} must be a non-empty string.`);
  return text;
}

function objectValue(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object.`);
  }
  return value;
}

function assertOfficialDocument(exchange, value, field) {
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
  const suffix = OFFICIAL_HOST_SUFFIXES[exchange];
  const hostname = url.hostname.toLowerCase();
  if (hostname !== suffix && !hostname.endsWith(`.${suffix}`)) {
    throw new TypeError(`${field} must belong to ${suffix}.`);
  }
  return url.toString();
}

function normalizeSnapshot(value, field, exchange) {
  const snapshot = objectValue(value, field);
  if (snapshot.complete !== true) {
    throw new TypeError(`${field}.complete must be true before membership can be trusted.`);
  }
  if (!Array.isArray(snapshot.records)) {
    throw new TypeError(`${field}.records must be an array.`);
  }
  const source = objectValue(snapshot.source, `${field}.source`);
  return Object.freeze({
    complete: true,
    records: snapshot.records,
    source: Object.freeze({
      document: assertOfficialDocument(exchange, source.document, `${field}.source.document`),
      version: requiredText(source.version, `${field}.source.version`),
      collectedAt: normalizeCollectedAt(source.collectedAt),
    }),
  });
}

function normalizeCode(value, field) {
  const code = String(value ?? "").replace(/\s+/g, "").trim();
  if (!/^\d{6}$/.test(code)) throw new TypeError(`${field} must be a six-digit code.`);
  return code;
}

function compositeProvenance(exchange, allSnapshot, t0Snapshot) {
  return Object.freeze({
    provider: exchange,
    document: `all=${allSnapshot.source.document};t0=${t0Snapshot.source.document}`,
    version: `all=${allSnapshot.source.version};t0=${t0Snapshot.source.version}`,
    collectedAt: [allSnapshot.source.collectedAt, t0Snapshot.source.collectedAt].sort().at(-1),
  });
}

class OfficialExchangeEtfSource {
  constructor({ exchange, fetchAllEtfs, fetchT0Etfs } = {}) {
    this.exchange = normalizeExchange(exchange);
    if (typeof fetchAllEtfs !== "function") throw new TypeError("fetchAllEtfs must be a function.");
    if (typeof fetchT0Etfs !== "function") throw new TypeError("fetchT0Etfs must be a function.");
    this.fetchAllEtfs = fetchAllEtfs;
    this.fetchT0Etfs = fetchT0Etfs;
  }

  async fetchFacts() {
    const [rawAll, rawT0] = await Promise.all([
      this.fetchAllEtfs(),
      this.fetchT0Etfs(),
    ]);
    const allSnapshot = normalizeSnapshot(rawAll, "allEtfs", this.exchange);
    const t0Snapshot = normalizeSnapshot(rawT0, "t0Etfs", this.exchange);
    const market = EXCHANGE_MARKETS[this.exchange];
    const all = new Map();

    allSnapshot.records.forEach((item, index) => {
      const record = objectValue(item, `allEtfs.records[${index}]`);
      const code = normalizeCode(record.code, `allEtfs.records[${index}].code`);
      if (all.has(code)) throw new TypeError(`allEtfs contains duplicate ETF code: ${code}`);
      all.set(code, Object.freeze({
        code,
        effectiveFrom: requiredText(
          record.effectiveFrom ?? record.listingDate,
          `allEtfs.records[${index}].effectiveFrom`
        ),
      }));
    });

    const t0Codes = new Set();
    t0Snapshot.records.forEach((item, index) => {
      const record = typeof item === "string" ? { code: item } : objectValue(item, `t0Etfs.records[${index}]`);
      const code = normalizeCode(record.code, `t0Etfs.records[${index}].code`);
      if (!all.has(code)) {
        throw new TypeError(`T+0 ETF ${code} is absent from the complete ETF snapshot.`);
      }
      if (t0Codes.has(code)) throw new TypeError(`t0Etfs contains duplicate ETF code: ${code}`);
      t0Codes.add(code);
    });

    const provenance = compositeProvenance(this.exchange, allSnapshot, t0Snapshot);
    const records = [...all.values()]
      .sort((left, right) => left.code.localeCompare(right.code))
      .map((item) => normalizeEtfSecurityFact({
        exchange: this.exchange,
        security: { code: item.code, market },
        intradayRoundTripEligible: t0Codes.has(item.code),
        effectiveFrom: item.effectiveFrom,
        effectiveTo: null,
        provenance,
        qualityIssues: ["etf_eligibility_derived_from_complete_official_membership_snapshots"],
      }));

    return Object.freeze({
      exchange: this.exchange,
      records: Object.freeze(records),
      summary: Object.freeze({
        etfCount: records.length,
        t0Count: t0Codes.size,
        t1Count: records.length - t0Codes.size,
      }),
      source: provenance,
    });
  }
}

assertEtfSecuritySource(new OfficialExchangeEtfSource({
  exchange: "sse",
  fetchAllEtfs: async () => ({
    complete: true,
    records: [],
    source: { document: "https://www.sse.com.cn/test", version: "test", collectedAt: "2026-08-12T00:00:00Z" },
  }),
  fetchT0Etfs: async () => ({
    complete: true,
    records: [],
    source: { document: "https://www.sse.com.cn/test", version: "test", collectedAt: "2026-08-12T00:00:00Z" },
  }),
}));

module.exports = {
  EXCHANGE_MARKETS,
  OFFICIAL_HOST_SUFFIXES,
  OfficialExchangeEtfSource,
  assertOfficialDocument,
  compositeProvenance,
  normalizeCode,
  normalizeSnapshot,
};
