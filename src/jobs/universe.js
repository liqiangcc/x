"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

async function hasCompleteMarketUniverse(date, outputDir, market = "hs-a") {
  const universeDir = path.join(outputDir, date);
  try {
    const codesPayload = JSON.parse(await fs.readFile(path.join(universeDir, "codes.json"), "utf8"));
    const stocksPayload = JSON.parse(await fs.readFile(path.join(universeDir, "stocks.json"), "utf8"));
    return (
      codesPayload.date === date &&
      stocksPayload.date === date &&
      codesPayload.market === market &&
      stocksPayload.market === market &&
      Array.isArray(codesPayload.codes) &&
      Array.isArray(stocksPayload.stocks) &&
      codesPayload.codes.length > 0 &&
      codesPayload.codes.length === stocksPayload.stocks.length
    );
  } catch {
    return false;
  }
}

function shouldReuseMarketUniverse({ complete, forceUniverse = false }) {
  return Boolean(complete) && !forceUniverse;
}

module.exports = {
  hasCompleteMarketUniverse,
  shouldReuseMarketUniverse,
};
