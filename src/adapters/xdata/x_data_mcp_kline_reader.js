"use strict";

const { assertKlineReader } = require("../../ports/market/kline_reader");
const { DataMode, PriceView } = require("../../simulator/core/enums");
const { XDataMcpClient } = require("./x_data_mcp_client");

const DEFAULT_START_DATE = "1900-01-01";
const CONTRACT_VERSION = "v1";
const STALE_VERSION_CODE = "stale_version";
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

// Yearly stale / absent-reason fields are final in generic-data-v6 §6: they
// live on the manifest entry top level — `stale:"behind"` + `as_of_day` for
// present entries, `reason:<AbsentReason>` for absent ones. Read them exactly
// there and pass them through untouched; never swallow them. generic-data-v5
// emits none of these fields, so they read null and the entry counts as fresh.
function pick(item, key) {
  const value = item?.[key];
  return value === undefined || value === null || value === "" ? null : value;
}

function passthroughStale(manifestItem) {
  return {
    stale: pick(manifestItem, "stale"),
    asOfDay: pick(manifestItem, "as_of_day"),
  };
}

function passthroughReason(manifestItem) {
  const reason = pick(manifestItem, "reason");
  return reason === null ? null : String(reason);
}

class XDataMcpKlineReader {
  constructor({ client = null, socketPath = null, timeoutMs = undefined } = {}) {
    this.client = client ?? new XDataMcpClient({ socketPath, timeoutMs });
    assertKlineReader(this);
  }

  async close() {
    await this.client.close?.();
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

  // Reads the current series of one entity. The version is never pinned on the
  // client: `latest_per_entity` resolves it inside one server-side snapshot, and
  // the cursor keeps later pages on that snapshot. Under the single-version model
  // (generic-data-v6) an old version_id is rejected with `stale_version`, so a
  // client-side pin cache would only ever go stale.
  async #queryLatest({ dataset, entity, filter }) {
    const base = {
      dataset,
      contract_version: CONTRACT_VERSION,
      selection: { kind: "single", entity },
      filter,
      version: { kind: "latest_per_entity" },
      page_size: 1000,
    };
    const records = [];
    let cursor = null;
    let manifestItem = null;
    let versionRef = null;
    let sourceMeta = null;
    for (let page = 0; page < 1000; page += 1) {
      const payload = await this.client.callTool("query_data", cursor ? { ...base, cursor } : base);
      if (page === 0) {
        manifestItem = (payload?.version_manifest ?? [])
          .find((item) => sameEntity(item?.entity, entity)) ?? null;
        sourceMeta = {
          snapshot_id: payload?.snapshot_id ?? null,
          query_time: payload?.query_time ?? null,
          limitations: Array.isArray(payload?.limitations) ? payload.limitations : [],
        };
        if (!manifestItem || manifestItem.status === "absent") {
          return { absent: true, manifestItem, records, sourceMeta, versionRef: null };
        }
        versionRef = manifestItem.version_ref ?? null;
        assertConfirmedQfq(manifestItem, versionRef);
      }
      for (const record of payload?.records ?? []) {
        if (!sameEntity(record?.entity, entity)) {
          const error = new TypeError("x-data-mcp returned a record for an unexpected entity.");
          error.code = "x_data_mcp_entity_mismatch";
          throw error;
        }
        if (record?.version_ref?.version_id !== versionRef.version_id) {
          const error = new TypeError("x-data-mcp returned a record outside the resolved version.");
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
    return { absent: false, manifestItem, records, sourceMeta, versionRef };
  }

  // `stale_version` means the server replaced the content between two calls (it
  // is only returned for explicit version ids, so on the latest path it is a
  // defensive case). Re-run the whole read once for market.daily; a second
  // failure is thrown. A market.yearly single-entity `stale_version` instead
  // means the derived series is invalid (generic-data-v6 §6) and re-querying
  // fails identically, so it is never retried. `version_not_found` and every
  // other error are never retried.
  async #queryLatestWithRetry(args) {
    try {
      return await this.#queryLatest(args);
    } catch (error) {
      if (error?.code !== STALE_VERSION_CODE || args.dataset !== DATASETS.daily) {
        throw error;
      }
      return this.#queryLatest(args);
    }
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
    const { absent, manifestItem, records, sourceMeta, versionRef } = await this.#queryLatestWithRetry({
      dataset,
      entity,
      filter: this.#filter({ period: normalizedPeriod, startDate: normalizedStart, endDate: normalizedEnd }),
    });
    if (absent) {
      const reason = passthroughReason(manifestItem);
      return {
        security: { code: normalizedCode, market: normalizedMarket },
        period: normalizedPeriod,
        startDate: normalizedStart,
        endDate: normalizedEnd,
        bars: [],
        dataMode: DataMode.LEGACY_APPROXIMATE,
        priceView: PriceView.LEGACY_FORWARD_ADJUSTED,
        qualityIssues: [
          `missing_${normalizedPeriod}_kline`,
          ...(reason ? [`x_data_mcp_absent_reason:${reason}`] : []),
        ],
        source: {
          kind: "x_data_mcp",
          dataset,
          versionId: null,
        },
        contentHash: null,
        sourcePath: null,
      };
    }
    const stale = passthroughStale(manifestItem);

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
        ...(stale.stale ? [`x_data_mcp_stale:${stale.stale}`] : []),
      ],
      source: {
        kind: "x_data_mcp",
        dataset,
        versionId: versionRef.version_id,
        integritySha256: versionRef.integrity_sha256,
        snapshotId: sourceMeta?.snapshot_id ?? null,
        queryTime: sourceMeta?.query_time ?? null,
        limitations: sourceMeta?.limitations ?? [],
        ...(stale.stale ? { stale: stale.stale } : {}),
        ...(stale.asOfDay ? { asOfDay: stale.asOfDay } : {}),
      },
      contentHash: versionRef.integrity_sha256 ?? null,
      sourcePath: null,
    };
  }
}

module.exports = {
  CONTRACT_VERSION,
  DATASETS,
  STALE_VERSION_CODE,
  DEFAULT_START_DATE,
  XDataMcpKlineReader,
  exchangeToMarket,
  marketToExchange,
  normalizeIsoDate,
};
