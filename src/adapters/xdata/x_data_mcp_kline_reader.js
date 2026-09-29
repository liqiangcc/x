"use strict";

const { assertKlineReader } = require("../../ports/market/kline_reader");
const { DataMode, PriceView } = require("../../simulator/core/enums");
const { XDataMcpClient } = require("./x_data_mcp_client");

const DEFAULT_START_DATE = "1900-01-01";
const CONTRACT_VERSION = "v1";
const DATASETS = Object.freeze({
  daily: "market.daily",
  yearly: "market.yearly",
});

function normalizeIsoDate(value, field) {
  const text = String(value ?? "").trim();
  const match = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(text);
  if (!match) throw new TypeError(`${field} must use YYYYMMDD or YYYY-MM-DD.`);
  const normalized = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new TypeError(`${field} must be a valid calendar date.`);
  }
  return normalized;
}

function normalizeOptionalIsoDate(value, field) {
  if (value === undefined || value === null || value === "") return null;
  return normalizeIsoDate(value, field);
}

function normalizePeriod(value) {
  if (!Object.hasOwn(DATASETS, value)) {
    throw new TypeError(`Unsupported x-data-mcp kline period: ${value}`);
  }
  return value;
}

function marketToExchange(value) {
  const market = Number(value);
  if (market === 1) return "sh";
  if (market === 0) return "sz";
  throw new TypeError(`x-data-mcp currently supports market 1=sh and 0=sz; got ${value}`);
}

function exchangeToMarket(value) {
  if (value === "sh") return 1;
  if (value === "sz") return 0;
  throw new TypeError(`Unsupported x-data-mcp exchange: ${value}`);
}

function normalizeOptionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeBar(record) {
  const date = normalizeIsoDate(record?.date, "record.date");
  return {
    date,
    open: normalizeOptionalNumber(record?.open),
    close: normalizeOptionalNumber(record?.close),
    high: normalizeOptionalNumber(record?.high),
    low: normalizeOptionalNumber(record?.low),
    volume: normalizeOptionalNumber(record?.volume),
    amount: normalizeOptionalNumber(record?.amount),
    changePct: null,
  };
}

function sameEntity(left, right) {
  return left?.code === right?.code && left?.exchange === right?.exchange;
}

function assertConfirmedQfq(record, versionRef) {
  const adjustment = record?.metadata?.adjustment;
  if (
    record?.status !== "present"
    || !versionRef
    || adjustment?.status !== "confirmed"
    || adjustment?.value !== "qfq"
  ) {
    const error = new TypeError(
      `x-data-mcp ${versionRef?.dataset ?? "market"} version for ${versionRef?.entity?.exchange}.${versionRef?.entity?.code} does not prove confirmed qfq data.`
    );
    error.code = "x_data_mcp_adjustment_not_confirmed";
    throw error;
  }
}

class XDataMcpKlineReader {
  constructor({ client = null, socketPath = null, timeoutMs = undefined } = {}) {
    this.client = client ?? new XDataMcpClient({ socketPath, timeoutMs });
    this.pinnedVersions = new Map();
    assertKlineReader(this);
  }

  async close() {
    await this.client.close?.();
  }

  async #resolveVersion({ dataset, entity }) {
    const key = `${dataset}:${entity.exchange}.${entity.code}`;
    if (this.pinnedVersions.has(key)) return this.pinnedVersions.get(key);
    const payload = await this.client.callTool("list_data_versions", {
      dataset,
      contract_version: CONTRACT_VERSION,
      selection: { kind: "single", entity },
      page_size: 1000,
    });
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const item = items.find(({ version_ref: ref }) => sameEntity(ref?.entity, entity));
    const versionRef = item?.version_ref ?? null;
    this.pinnedVersions.set(key, versionRef);
    return versionRef;
  }

  #filter({ period, startDate, endDate }) {
    if (period === "daily") {
      return {
        kind: "daily",
        start_date: startDate ?? DEFAULT_START_DATE,
        end_date: endDate,
      };
    }
    return {
      kind: "yearly",
      start_year: Number((startDate ?? DEFAULT_START_DATE).slice(0, 4)),
      end_year: Number(endDate.slice(0, 4)),
    };
  }

  async #queryRecords({ dataset, entity, filter, versionRef }) {
    const base = {
      dataset,
      contract_version: CONTRACT_VERSION,
      selection: { kind: "single", entity },
      filter,
      version: {
        kind: "explicit_version_map",
        versions: [{ entity, version_id: versionRef.version_id }],
      },
      page_size: 1000,
    };
    const records = [];
    let cursor = null;
    let manifestItem = null;
    let sourceMeta = null;
    for (let page = 0; page < 1000; page += 1) {
      const payload = await this.client.callTool("query_data", cursor ? { ...base, cursor } : base);
      if (page === 0) {
        manifestItem = (payload?.version_manifest ?? [])
          .find((item) => sameEntity(item?.entity, entity)) ?? null;
        assertConfirmedQfq(manifestItem, versionRef);
        sourceMeta = {
          snapshot_id: payload?.snapshot_id ?? null,
          query_time: payload?.query_time ?? null,
          limitations: Array.isArray(payload?.limitations) ? payload.limitations : [],
        };
      }
      for (const record of payload?.records ?? []) {
        if (!sameEntity(record?.entity, entity)) {
          const error = new TypeError("x-data-mcp returned a record for an unexpected entity.");
          error.code = "x_data_mcp_entity_mismatch";
          throw error;
        }
        if (record?.version_ref?.version_id !== versionRef.version_id) {
          const error = new TypeError("x-data-mcp returned a record outside the pinned version.");
          error.code = "x_data_mcp_version_mismatch";
          throw error;
        }
        records.push(normalizeBar(record));
      }
      cursor = payload?.next_cursor ?? null;
      if (!cursor) break;
      if (payload?.page_complete === true && !cursor) break;
    }
    records.sort((left, right) => left.date.localeCompare(right.date));
    return { records, sourceMeta };
  }

  async readRange({ code, market, startDate = null, endDate, period = "daily", limit = null } = {}) {
    const normalizedCode = String(code ?? "").trim();
    if (!/^\d{6}$/.test(normalizedCode)) {
      throw new TypeError("code must be a six-digit security code.");
    }
    const normalizedMarket = Number(market);
    const exchange = marketToExchange(normalizedMarket);
    const normalizedStart = normalizeOptionalIsoDate(startDate, "startDate");
    const normalizedEnd = normalizeIsoDate(endDate, "endDate");
    if (normalizedStart && normalizedStart > normalizedEnd) {
      throw new TypeError("startDate must not be after endDate.");
    }
    const normalizedPeriod = normalizePeriod(period);
    if (limit !== null && limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      throw new TypeError("limit must be a positive integer or null.");
    }

    const dataset = DATASETS[normalizedPeriod];
    const entity = { exchange, code: normalizedCode };
    const versionRef = await this.#resolveVersion({ dataset, entity });
    if (!versionRef) {
      return {
        security: { code: normalizedCode, market: normalizedMarket },
        period: normalizedPeriod,
        startDate: normalizedStart,
        endDate: normalizedEnd,
        bars: [],
        dataMode: DataMode.LEGACY_APPROXIMATE,
        priceView: PriceView.LEGACY_FORWARD_ADJUSTED,
        qualityIssues: [`missing_${normalizedPeriod}_kline`],
        source: {
          kind: "x_data_mcp",
          dataset,
          versionId: null,
        },
        contentHash: null,
        sourcePath: null,
      };
    }

    const { records, sourceMeta } = await this.#queryRecords({
      dataset,
      entity,
      filter: this.#filter({ period: normalizedPeriod, startDate: normalizedStart, endDate: normalizedEnd }),
      versionRef,
    });

    return {
      security: {
        code: normalizedCode,
        market: exchangeToMarket(versionRef.entity.exchange),
      },
      period: normalizedPeriod,
      startDate: normalizedStart,
      endDate: normalizedEnd,
      bars: records,
      dataMode: DataMode.LEGACY_APPROXIMATE,
      priceView: PriceView.LEGACY_FORWARD_ADJUSTED,
      qualityIssues: [
        "legacy_approximate",
        "current_generation_qfq_not_point_in_time",
        "raw_execution_price_unavailable",
      ],
      source: {
        kind: "x_data_mcp",
        dataset,
        versionId: versionRef.version_id,
        integritySha256: versionRef.integrity_sha256,
        snapshotId: sourceMeta?.snapshot_id ?? null,
        queryTime: sourceMeta?.query_time ?? null,
        limitations: sourceMeta?.limitations ?? [],
      },
      contentHash: versionRef.integrity_sha256 ?? null,
      sourcePath: null,
    };
  }
}

module.exports = {
  CONTRACT_VERSION,
  DATASETS,
  DEFAULT_START_DATE,
  XDataMcpKlineReader,
  exchangeToMarket,
  marketToExchange,
  normalizeIsoDate,
};
