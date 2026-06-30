"use strict";

function normalizeDate(input) {
  const digits = String(input).replace(/-/g, "");
  if (!/^\d{8}$/.test(digits)) {
    throw new Error(`Invalid date format: ${input}`);
  }

  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: ${input}`);
  }

  return digits;
}

function formatLocalDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function formatDateInTimeZone(date = new Date(), timeZone = "Asia/Shanghai") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}`;
}

function formatMarketDate(offsetDays = 0, date = new Date()) {
  const shifted = new Date(date.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  return formatDateInTimeZone(shifted, "Asia/Shanghai");
}

function toUtcDate(yyyymmdd) {
  const normalized = normalizeDate(yyyymmdd);
  return new Date(Date.UTC(
    Number(normalized.slice(0, 4)),
    Number(normalized.slice(4, 6)) - 1,
    Number(normalized.slice(6, 8))
  ));
}

function calculateInclusiveDays(startDate, endDate) {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.max(Math.floor((toUtcDate(endDate) - toUtcDate(startDate)) / millisecondsPerDay) + 1, 1);
}

module.exports = {
  calculateInclusiveDays,
  formatDateInTimeZone,
  formatLocalDate,
  formatMarketDate,
  normalizeDate,
  toUtcDate,
};
