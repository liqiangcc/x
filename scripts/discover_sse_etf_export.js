#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const PAGE_URL = "https://etf.sse.com.cn/fundlist/";
const DEFAULT_OUTPUT_DIR = "artifacts/sse-etf-export-discovery";
const KEYWORD_PATTERN = /(export|excel|xlsx?|download|fundlist|commonquery|query\.sse|turnover|回转|导出)/i;

function sha256(buffer) {
  return `sha256:${crypto.createHash("sha256").update(buffer).digest("hex")}`;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/discover_sse_etf_export.js [--output-dir DIR]",
    "",
    "Fetches the official SSE ETF fund-list page and its versioned fundlist.js controller,",
    "then records export-related strings/snippets as auditable discovery evidence.",
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

function extractFundlistScript(html) {
  const scriptSources = extractScriptSources(html);
  const candidates = scriptSources.filter((value) => /(?:^|\/)fundlist\.js(?:\?|$)/i.test(value));

  // Some legacy pages embed the controller path outside a canonical script tag.
  // Keep this as evidence-based fallback: it still requires the literal fundlist.js
  // reference to exist in the downloaded official HTML.
  if (candidates.length === 0) {
    const broadMatches = html.match(/(?:https?:\/\/|\/)[^"'<>\s]*fundlist\.js(?:\?[^"'<>\s]*)?/gi) ?? [];
    for (const value of broadMatches) {
      if (!candidates.includes(value)) candidates.push(value);
    }
  }

  if (candidates.length !== 1) {
    const error = new Error(`expected exactly one fundlist.js reference, got ${candidates.length}`);
    error.discovery = { scriptSources, fundlistCandidates: candidates };
    throw error;
  }
  return {
    url: new URL(candidates[0], PAGE_URL).href,
    scriptSources,
    fundlistCandidates: candidates,
  };
}

function surroundingSnippets(text, pattern = KEYWORD_PATTERN, radius = 220) {
  const lines = text.split(/\r?\n/);
  const snippets = [];
  for (let index = 0; index < lines.length; index += 1) {
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

async function writeFile(dir, name, value) {
  const target = path.join(dir, name);
  await fs.writeFile(target, value);
  return target;
}

function pageEvidence(page) {
  return {
    requestedUrl: PAGE_URL,
    finalUrl: page.url,
    status: page.status,
    contentType: page.contentType,
    contentDisposition: page.contentDisposition,
    byteLength: page.buffer.length,
    contentHash: sha256(page.buffer),
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

  // Persist the raw official page before controller parsing. Even a discovery
  // failure therefore leaves auditable evidence for the next parser revision.
  await writeFile(outputDir, "fundlist.html", page.buffer);

  let controllerRef;
  try {
    controllerRef = extractFundlistScript(html);
  } catch (error) {
    const partial = {
      collectedAt: new Date().toISOString(),
      page: pageEvidence(page),
      controller: null,
      evidence: {
        scriptSources: error.discovery?.scriptSources ?? extractScriptSources(html),
        fundlistCandidates: error.discovery?.fundlistCandidates ?? [],
        pageKeywordSnippets: surroundingSnippets(html),
      },
      error: error.message,
    };
    await writeFile(outputDir, "discovery.json", `${JSON.stringify(partial, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(partial, null, 2)}\n`);
    throw error;
  }

  const controller = await fetchOfficial(controllerRef.url, { referer: PAGE_URL });
  const js = controller.buffer.toString("utf8");

  const discovery = {
    collectedAt: new Date().toISOString(),
    page: pageEvidence(page),
    controller: {
      url: controller.url,
      status: controller.status,
      contentType: controller.contentType,
      contentDisposition: controller.contentDisposition,
      byteLength: controller.buffer.length,
      contentHash: sha256(controller.buffer),
    },
    evidence: {
      scriptSources: controllerRef.scriptSources,
      fundlistCandidates: controllerRef.fundlistCandidates,
      interestingStringLiterals: extractInterestingStringLiterals(js),
      candidateUrls: extractCandidateUrls(js, controller.url),
      keywordSnippets: surroundingSnippets(js),
    },
  };

  await writeFile(outputDir, "fundlist.js", controller.buffer);
  await writeFile(outputDir, "discovery.json", `${JSON.stringify(discovery, null, 2)}\n`);

  process.stdout.write(`${JSON.stringify(discovery, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = {
  extractFundlistScript,
  extractScriptSources,
};
