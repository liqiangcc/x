#!/usr/bin/env node

"use strict";

const {
  getAllEtfs,
  getAllSectors,
  getAllStocks,
  getEtfDetails,
  getKline,
  getSectors,
  getStocks,
} = (() => {
  const client = require("../src/sources/eastmoney/client");
  return {
    ...client,
    getSectors: client.getSectors,
    getStocks: client.getStocks,
  };
})();

function printUsage() {
  console.error("Usage:");
  console.error("  node api/call_ttjj_api.js get_sectors [page_number]");
  console.error("  node api/call_ttjj_api.js get_stocks <sector_code> [page_number]");
  console.error("  node api/call_ttjj_api.js get_kline <secid> <klt> <lmt> <end_date>");
  console.error("  node api/call_ttjj_api.js get_etfs");
  console.error("  node api/call_ttjj_api.js get_etf_details <etf_code>");
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  let payload;
  if (command === "get_sectors") {
    payload = args[0] ? await getSectors(Number(args[0])) : await getAllSectors();
  } else if (command === "get_stocks") {
    const [sectorCode, page] = args;
    if (!sectorCode) {
      throw new Error("get_stocks requires <sector_code>");
    }
    payload = page ? await getStocks(sectorCode, Number(page)) : await getAllStocks(sectorCode);
  } else if (command === "get_kline") {
    const [secid, klt, lmt, end] = args;
    if (!secid || !klt || !lmt || !end) {
      throw new Error("get_kline requires <secid> <klt> <lmt> <end_date>");
    }
    payload = await getKline({ secid, klt, lmt, end });
  } else if (command === "get_etfs") {
    payload = await getAllEtfs();
  } else if (command === "get_etf_details") {
    const [fundCode] = args;
    if (!fundCode) {
      throw new Error("get_etf_details requires <etf_code>");
    }
    payload = await getEtfDetails(fundCode);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
