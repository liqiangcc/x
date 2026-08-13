#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const PAGE_URL = "https://etf.sse.com.cn/fundlist/";
const DEFAULT_OUTPUT_DIR = "artifacts/sse-etf-export-discovery";
const KEYWORD_PATTERN = /(export|excel|xlsx?|download|fundlist|commonquery|query\.sse|turnover|回转|导出)/i;
const API_NAMES = Object.freeze([
  "exportExcelFundData_new",
  "exportExcelFundData",
  "getFundList",
  "getFundListNoPagination",
]);

function sha256(buffer) {
  return `sha256:${crypto.createHash("sha256").update(buffer).digest("hex")}`;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/discover_sse_etf_export.js [--output-dir DIR]",
    "",
    "Fetches the official SSE ETF fund-list page, its fundlist controller, and api.js,",
    "then records export-related endpoints/snippets as auditable discovery evidence.",
    "This script does not write Security Master data and does not guess ETF/T+0 eligibility.",
  ].join("\n");
}

function parseArgs(argv) {
  const result = { outputDir: DEFAULT_OUTPUT_DIR };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--output-dir") {
      const value = argv[index + 1];
      if (!value) throw new Error("--output-dir requires a value.");
      result.outputDir = value;
      index += 1;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }
  return result;
}

async function fetchOfficial(url, { referer = PAGE_URL } = {}) {
  let response;
  try {
    response = await fetch(url, {
      redirect: "follow",
      headers: {
        accept: "*/*",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        referer,
        "user-agent": "Mozilla/5.0 (X Security Master source verification; +https://github.com/liqiangcc/x)",
      },
    });
  } catch (error) {
    const cause = error?.cause;
    const detail = cause
      ? `; cause=${cause.code || cause.name || "unknown"}: ${cause.message || String(cause)}`
      : "";
    throw new Error(`GET ${url} failed before an HTTP response${detail}`, { cause: error });
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    throw new Error(`GET ${url} failed with HTTP ${response.status}; body sha=${sha256(buffer)}`);
  }
  return {
    url: response.url,
    status: response.status,
    contentType: response.headers.get("content-type"),
    contentDisposition: response.headers.get("content-disposition"),
    buffer,
  };
}

function extractScriptSources(html) {
  const sources = [];
  const seen = new Set();
  const tags = html.match(/<script\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const match = /\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(tag);
    const value = match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
    if (!value || seen.has(value)) continue;
    seen.add(value);
    sources.push(value);
  }
  return sources;
}

function extractLazyLoadSources(html) {
  const result = [];
  const seen = new Set();
  const blocks = [...html.matchAll(/<[^>]+\bid=["']loadjs["'][^>]*>([\s\S]*?)<\/[^>]+>/gi)];
  for (const block of blocks) {
    const text = String(block[1] ?? "").replace(/<[^>]+>/g, "").trim();
    for (const item of text.split(",")) {
      const value = item.trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function pageJavaScriptSources(html) {
  const values = [...extractScriptSources(html), ...extractLazyLoadSources(html)];
  return [...new Set(values)];
}

function selectSingleSource(html, pattern, label) {
  const sources = pageJavaScriptSources(html);
  const candidates = sources.filter((value) => pattern.test(value));
  if (candidates.length !== 1) {
    const error = new Error(`expected exactly one ${label} reference, got ${candidates.length}`);
    error.discovery = { sources, candidates };
    throw error;
  }
  return {
    url: new URL(candidates[0], PAGE_URL).href,
    sources,
    candidates,
  };
}

function extractFundlistScript(html) {
  return selectSingleSource(html, /(?:^|\/)fundlist\.js(?:\?|$)/i, "fundlist.js");
}

function extractApiScript(html) {
  return selectSingleSource(html, /(?:^|\/)api\.js(?:\?|$)/i, "api.js");
}

function surroundingSnippets(text, pattern = KEYWORD_PATTERN, radius = 220) {
  const lines = text.split(/\r?\n/);
  const snippets = [];
  for (let index = 0; index < lines.length; index += 1) {
    pattern.lastIndex = 0;
    if (!pattern.test(lines[index])) continue;
    const start = Math.max(0, index - 2);
    const end = Math.min(lines.length, index + 3);
    snippets.push({
      line: index + 1,
      text: lines.slice(start, end).join("\n").slice(0, radius * 5),
    });
  }
  return snippets.slice(0, 120);
}

function extractInterestingStringLiterals(text) {
  const values = [];
  const seen = new Set();
  const pattern = /(["'`])((?:\\.|(?!\1)[\s\S]){1,500})\1/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const value = match[2];
    if (!KEYWORD_PATTERN.test(value)) continue;
    const normalized = value.replace(/\\(["'`])/g, "$1");
    if (!seen.has(normalized)) {
      seen.add(normalized);
      values.push(normalized);
    }
  }
  return values.slice(0, 250);
}

function extractCandidateUrls(text, baseUrl) {
  const candidates = new Set();
  const absolutePattern = /https?:\/\/[^\s"'`<>]+/gi;
  for (const match of text.match(absolutePattern) ?? []) {
    if (KEYWORD_PATTERN.test(match)) candidates.add(match.replace(/[),;]+$/, ""));
  }

  const stringPattern = /(["'`])([^"'`]{1,500})\1/g;
  let match;
  while ((match = stringPattern.exec(text)) !== null) {
    const value = match[2].trim();
    if (!KEYWORD_PATTERN.test(value)) continue;
    if (!(value.startsWith("http://") || value.startsWith("https://") || value.startsWith("/"))) continue;
    try {
      candidates.add(new URL(value, baseUrl).href);
    } catch {
      // Malformed string literals are evidence only, never request targets.
    }
  }
  return [...candidates].sort();
}

function extractApiConstantSnippets(text, names = API_NAMES) {
  const lines = text.split(/\r?\n/);
  const result = {};
  for (const name of names) {
    const matches = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].includes(name)) continue;
      matches.push({
        line: index + 1,
        text: lines.slice(Math.max(0, index - 1), Math.min(lines.length, index + 2)).join("\n").trim(),
      });
    }
    result[name] = matches;
  }
  return result;
}

function extractSwingTradeValue(html) {
  const match = /<input\b[^>]*\bid=["']SWING_TRADE["'][^>]*>/i.exec(html);
  if (!match) return null;
  const value = /\bvalue\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(match[0]);
  return value?.[1] ?? value?.[2] ?? value?.[3] ?? "";
}

async function writeFile(dir, name, value) {
  const target = path.join(dir, name);
  await fs.writeFile(target, value);
  return target;
}

function responseEvidence(response, requestedUrl = response.url) {
  return {
    requestedUrl,
    finalUrl: response.url,
    status: response.status,
    contentType: response.contentType,
    contentDisposition: response.contentDisposition,
    byteLength: response.buffer.length,
    contentHash: sha256(response.buffer),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const outputDir = path.resolve(options.outputDir);
  await fs.mkdir(outputDir, { recursive: true });

  const page = await fetchOfficial(PAGE_URL, { referer: "https://etf.sse.com.cn/" });
  const html = page.buffer.toString("utf8");
  await writeFile(outputDir, "fundlist.html", page.buffer);

  const commonEvidence = {
    scriptSources: extractScriptSources(html),
    lazyLoadSources: extractLazyLoadSources(html),
    swingTradeValue: extractSwingTradeValue(html),
    pageKeywordSnippets: surroundingSnippets(html),
  };

  let controllerRef;
  let apiRef;
  try {
    controllerRef = extractFundlistScript(html);
    apiRef = extractApiScript(html);
  } catch (error) {
    const partial = {
      collectedAt: new Date().toISOString(),
      page: responseEvidence(page, PAGE_URL),
      controller: null,
      api: null,
      evidence: {
        ...commonEvidence,
        sourceDiscovery: error.discovery ?? null,
      },
      error: error.message,
    };
    await writeFile(outputDir, "discovery.json", `${JSON.stringify(partial, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(partial, null, 2)}\n`);
    throw error;
  }

  const [controller, api] = await Promise.all([
    fetchOfficial(controllerRef.url, { referer: PAGE_URL }),
    fetchOfficial(apiRef.url, { referer: PAGE_URL }),
  ]);
  const js = controller.buffer.toString("utf8");
  const apiJs = api.buffer.toString("utf8");

  const discovery = {
    collectedAt: new Date().toISOString(),
    page: responseEvidence(page, PAGE_URL),
    controller: responseEvidence(controller, controllerRef.url),
    api: responseEvidence(api, apiRef.url),
    evidence: {
      ...commonEvidence,
      fundlistCandidates: controllerRef.candidates,
      apiCandidates: apiRef.candidates,
      apiConstants: extractApiConstantSnippets(apiJs),
      apiCandidateUrls: extractCandidateUrls(apiJs, api.url),
      controllerInterestingStringLiterals: extractInterestingStringLiterals(js),
      controllerCandidateUrls: extractCandidateUrls(js, controller.url),
      controllerKeywordSnippets: surroundingSnippets(js),
    },
  };

  await writeFile(outputDir, "fundlist.js", controller.buffer);
  await writeFile(outputDir, "api.js", api.buffer);
  await writeFile(outputDir, "discovery.json", `${JSON.stringify(discovery, null, 2)}\n`);

  process.stdout.write(`${JSON.stringify(discovery, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  API_NAMES,
  extractApiConstantSnippets,
  extractApiScript,
  extractFundlistScript,
  extractLazyLoadSources,
  extractScriptSources,
  extractSwingTradeValue,
  pageJavaScriptSources,
};
