"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DEFAULT_STRATEGY_MARKET_BOARDS,
  marketBoardAllowed,
  marketBoardForCode,
  marketBoardsFromList,
  normalizeMarketBoards,
} = require("../src/core/market_board");

test("market boards classify A-share code families", () => {
  assert.equal(marketBoardForCode("600001"), "mainBoard");
  assert.equal(marketBoardForCode("300001"), "chiNext");
  assert.equal(marketBoardForCode("688001"), "starMarket");
  assert.equal(marketBoardForCode("920001"), "beijingExchange");
});

test("strategy board scope defaults to main and ChiNext", () => {
  assert.deepEqual(normalizeMarketBoards(null, DEFAULT_STRATEGY_MARKET_BOARDS), DEFAULT_STRATEGY_MARKET_BOARDS);
  const scope = marketBoardsFromList(["mainBoard", "chiNext"]);
  assert.equal(marketBoardAllowed({ code: "600001" }, scope), true);
  assert.equal(marketBoardAllowed({ code: "688001" }, scope), false);
  assert.throws(() => marketBoardsFromList(["unknown"]), /Unsupported market board/);
});
