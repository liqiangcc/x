"use strict";

const BOARD_KEYS = Object.freeze(["mainBoard", "chiNext", "starMarket", "beijingExchange"]);
const ALL_MARKET_BOARDS = Object.freeze(Object.fromEntries(BOARD_KEYS.map((key) => [key, true])));
const DEFAULT_STRATEGY_MARKET_BOARDS = Object.freeze({
  beijingExchange: false,
  chiNext: true,
  mainBoard: true,
  starMarket: false,
});

function marketBoardForCode(value) {
  const code = String(value?.code ?? value ?? "");
  if (/^(4|8|92)/.test(code)) return "beijingExchange";
  if (/^68[89]/.test(code)) return "starMarket";
  if (/^30[01]/.test(code)) return "chiNext";
  return "mainBoard";
}

function normalizeMarketBoards(value, defaults = ALL_MARKET_BOARDS) {
  return Object.fromEntries(BOARD_KEYS.map((key) => [key,
    typeof value?.[key] === "boolean" ? value[key] : defaults[key] !== false]));
}

function marketBoardAllowed(security, value, defaults = ALL_MARKET_BOARDS) {
  return normalizeMarketBoards(value, defaults)[marketBoardForCode(security)];
}

function marketBoardsFromList(values) {
  const selected = new Set(Array.isArray(values) ? values : String(values ?? "").split(",").filter(Boolean));
  for (const key of selected) {
    if (!BOARD_KEYS.includes(key)) throw new TypeError(`Unsupported market board: ${key}`);
  }
  return Object.fromEntries(BOARD_KEYS.map((key) => [key, selected.has(key)]));
}

module.exports = {
  ALL_MARKET_BOARDS,
  BOARD_KEYS,
  DEFAULT_STRATEGY_MARKET_BOARDS,
  marketBoardAllowed,
  marketBoardForCode,
  marketBoardsFromList,
  normalizeMarketBoards,
};
