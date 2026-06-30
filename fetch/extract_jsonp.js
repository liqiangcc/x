#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

function printUsage() {
  console.error("Usage: node fetch/extract_jsonp.js <input.txt> [output.json]");
}

function deriveOutputPath(inputPath) {
  const parsed = path.parse(inputPath);
  return path.join(parsed.dir, `${parsed.name}.json`);
}

function extractJsonString(rawText) {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error("Input file is empty.");
  }

  const match = trimmed.match(/^[\w$.]+\(([\s\S]*)\);?$/);
  if (!match) {
    throw new Error("Input does not match expected JSONP format.");
  }

  return match[1].trim();
}

async function main() {
  const [, , inputPathArg, outputPathArg] = process.argv;

  if (!inputPathArg) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const inputPath = path.resolve(inputPathArg);
  const outputPath = path.resolve(outputPathArg || deriveOutputPath(inputPathArg));

  let rawText;
  try {
    rawText = await fs.readFile(inputPath, "utf8");
  } catch (error) {
    throw new Error(`Failed to read input file: ${error.message}`);
  }

  const jsonText = extractJsonString(rawText);

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new Error(`Extracted content is not valid JSON: ${error.message}`);
  }

  const outputText = `${JSON.stringify(parsed, null, 2)}\n`;

  try {
    await fs.writeFile(outputPath, outputText, "utf8");
  } catch (error) {
    throw new Error(`Failed to write output file: ${error.message}`);
  }

  console.log(outputPath);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
