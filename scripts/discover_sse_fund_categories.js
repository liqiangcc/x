#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {
  fetchOfficialSse,
} = require("./sse_official_https_client");

const PAGE_URL = "https://etf.sse.com.cn/fundlist/";
const CATEGORY_URL = "https://query.sse.com.cn/commonQuery.do?sqlId=COMMON_JJZWZ_JJLB_JJLX_C";
const DEFAULT_OUTPUT_DIR = "artifacts/sse-etf-export-discovery";

function parseJsonOrJsonp(buffer) {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "").trim();
  if (!text) throw new TypeError("SSE fund category response is empty.");
  if (text.startsWith("{") || text.startsWith("[")) return JSON.parse(text);

  const firstObject = text.indexOf("{");
  const lastObject = text.lastIndexOf("}");
  if (firstObject >= 0 && lastObject > firstObject) {
    return JSON.parse(text.slice(firstObject, lastObject + 1));
  }
  throw new TypeError("SSE fund category response is neither JSON nor JSONP.");
}

function normalizeCategories(payload) {
  const rows = Array.isArray(payload?.result) ? payload.result : null;
  if (!rows) throw new TypeError("SSE fund category response must contain result[].");
  return rows.map((row, index) => {
    const code = String(row?.CATEGORY_CODE ?? "").trim();
    const parentCode = String(row?.CATEGORY_PARENT_CODE ?? "").trim();
    const name = String(row?.CATEGORY_NAME ?? "").trim();
    if (!code || !parentCode || !name) {
      throw new TypeError(`SSE fund category row ${index} is incomplete.`);
    }
    return Object.freeze({ code, parentCode, name });
  });
}

function buildTree(categories) {
  const byParent = new Map();
  for (const category of categories) {
    const list = byParent.get(category.parentCode) ?? [];
    list.push(category);
    byParent.set(category.parentCode, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.code.localeCompare(b.code));

  function children(parentCode, seen = new Set()) {
    return (byParent.get(parentCode) ?? []).map((category) => {
      if (seen.has(category.code)) {
        throw new TypeError(`SSE fund category cycle detected at ${category.code}.`);
      }
      const nextSeen = new Set(seen);
      nextSeen.add(category.code);
      return {
        ...category,
        children: children(category.code, nextSeen),
      };
    });
  }

  const roots = categories
    .filter((category) => category.parentCode === "-" || category.code === category.parentCode)
    .sort((a, b) => a.code.localeCompare(b.code));
  if (roots.length > 0) {
    return roots.map((root) => ({
      ...root,
      children: children(root.code, new Set([root.code])),
    }));
  }
  return children("F000");
}

async function main() {
  const outputDirIndex = process.argv.indexOf("--output-dir");
  const outputDir = path.resolve(
    outputDirIndex >= 0 && process.argv[outputDirIndex + 1]
      ? process.argv[outputDirIndex + 1]
      : DEFAULT_OUTPUT_DIR
  );
  await fs.mkdir(outputDir, { recursive: true });

  const response = await fetchOfficialSse(CATEGORY_URL, { referer: PAGE_URL });
  await fs.writeFile(path.join(outputDir, "fund-categories.raw"), response.buffer);

  const payload = parseJsonOrJsonp(response.buffer);
  const categories = normalizeCategories(payload);
  const result = {
    collectedAt: new Date().toISOString(),
    endpoint: CATEGORY_URL,
    status: response.status,
    contentType: response.contentType,
    recordCount: categories.length,
    categories,
    tree: buildTree(categories),
  };
  await fs.writeFile(
    path.join(outputDir, "fund-categories.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8"
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  CATEGORY_URL,
  buildTree,
  normalizeCategories,
  parseJsonOrJsonp,
};
