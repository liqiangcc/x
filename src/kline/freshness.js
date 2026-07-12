"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { getKlines, inspectKlinePayload, walkJsonFiles } = require("../../fetch/check_kline_empty");

function normalizeDate(value) {
  if (value === undefined || value === null || value === "") return null;
  const digits = String(value).replaceAll("-", "");
  if (!/^\d{8}$/.test(digits)) throw new Error(`Invalid expected latest date: ${value}`);
  const normalized = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new Error(`Invalid expected latest date: ${value}`);
  }
  return normalized;
}

function uniqueCodes(values) {
  return [...new Set(values.map((value) => String(value).trim()).filter((value) => /^\d{6}$/.test(value)))].sort();
}

async function loadCodesFile(codesFile) {
  const parsed = JSON.parse(await fs.readFile(codesFile, "utf8"));
  if (Array.isArray(parsed)) return uniqueCodes(parsed);
  if (Array.isArray(parsed?.codes)) return uniqueCodes(parsed.codes);
  throw new Error(`Codes file must be an array or contain a codes array: ${codesFile}`);
}

function latestKlineDate(payload) {
  const rows = getKlines(payload).value;
  if (!Array.isArray(rows)) return null;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const date = typeof rows[index] === "string" ? rows[index].split(",")[0] : "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  }
  return null;
}

function inferExpectedDate(distribution) {
  const entries = Object.entries(distribution);
  if (entries.length === 0) throw new Error("Cannot infer expected latest date because no valid Kline files were found.");
  return entries.sort((left, right) => right[1] - left[1] || right[0].localeCompare(left[0]))[0][0];
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

async function inspectKnownFile(code, file) {
  if (!file) return { code, file: null, issue: "missing", latest_date: null };
  let payload;
  try { payload = JSON.parse(await fs.readFile(file, "utf8")); } catch (error) {
    return { code, file, issue: "invalid_json", latest_date: null, error: error.message };
  }
  const issue = inspectKlinePayload(payload);
  if (issue) return { code, file, issue, latest_date: null };
  return { code, file, issue: null, latest_date: latestKlineDate(payload) };
}

async function inspectFreshness({ codesFile, expectedLatestDate, period, targetRoot }) {
  if (!["daily", "yearly"].includes(period)) throw new Error("--period must be daily or yearly.");
  const codes = await loadCodesFile(codesFile);
  const periodRoot = path.join(targetRoot, period);
  const existingFiles = await walkJsonFiles(periodRoot);
  const filesByCode = new Map();
  for (const file of existingFiles) {
    const code = path.basename(file, ".json");
    if (/^\d{6}$/.test(code) && (!filesByCode.has(code) || path.dirname(file) !== periodRoot)) filesByCode.set(code, file);
  }
  const inspected = await mapWithConcurrency(codes, 32, (code) => inspectKnownFile(code, filesByCode.get(code)));

  const distribution = {};
  for (const item of inspected.filter((entry) => !entry.issue && entry.latest_date)) {
    distribution[item.latest_date] = (distribution[item.latest_date] ?? 0) + 1;
  }
  const explicitDate = normalizeDate(expectedLatestDate);
  const expectedDate = explicitDate ?? inferExpectedDate(distribution);
  const categories = { fresh: [], stale: [], missing: [], invalid: [] };
  for (const item of inspected) {
    if (item.issue === "missing") categories.missing.push(item);
    else if (item.issue) categories.invalid.push(item);
    else if (item.latest_date < expectedDate) categories.stale.push(item);
    else categories.fresh.push(item);
  }

  const universe = new Set(codes);
  const extra = existingFiles.map((file) => ({ code: path.basename(file, ".json"), file }))
    .filter((item) => /^\d{6}$/.test(item.code) && !universe.has(item.code));
  const repairCodes = uniqueCodes([...categories.stale, ...categories.missing, ...categories.invalid].map((item) => item.code));
  const dates = Object.keys(distribution).sort();
  return {
    period,
    target_root: targetRoot,
    codes_file: codesFile,
    expected_latest_date: expectedDate,
    expected_date_source: explicitDate ? "explicit" : "inferred_mode",
    universe_count: codes.length,
    existing_file_count: existingFiles.length,
    valid_count: categories.fresh.length + categories.stale.length,
    fresh_count: categories.fresh.length,
    stale_count: categories.stale.length,
    missing_count: categories.missing.length,
    invalid_count: categories.invalid.length,
    extra_count: extra.length,
    repair_count: repairCodes.length,
    fresh_rate: codes.length === 0 ? 1 : categories.fresh.length / codes.length,
    earliest_latest_date: dates[0] ?? null,
    latest_latest_date: dates.at(-1) ?? null,
    latest_date_distribution: Object.fromEntries(Object.entries(distribution).sort(([left], [right]) => right.localeCompare(left))),
    categories: { ...categories, extra },
    repair_codes: repairCodes,
  };
}

async function writeRepairCodes(outputFile, report) {
  const payload = {
    period: report.period,
    expected_latest_date: report.expected_latest_date,
    total_codes: report.repair_codes.length,
    codes: report.repair_codes,
  };
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await fs.writeFile(outputFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

module.exports = { inferExpectedDate, inspectFreshness, latestKlineDate, loadCodesFile, normalizeDate, writeRepairCodes };
