"use strict";

const fs = require("node:fs");

const file = "bin/x";
let source = fs.readFileSync(file, "utf8");

const importAnchor = 'const { createProxyClashCommand } = require("../src/adapters/cli/commands/proxy_clash");\n';
const routerImport = 'const { createProxyCommand } = require("../src/adapters/cli/commands/proxy");\n';
if (!source.includes(routerImport)) {
  if (!source.includes(importAnchor)) throw new Error("Proxy import anchor not found");
  source = source.replace(importAnchor, routerImport + importAnchor);
}

const compositionAnchor = "const commandProxyClash = createProxyClashCommand();\n";
const composition = compositionAnchor + [
  "const commandProxy = createProxyCommand({",
  "  clashCommand: commandProxyClash,",
  "  poolCommand: commandProxyPool,",
  "});",
  "",
].join("\n");
if (!source.includes("const commandProxy = createProxyCommand({")) {
  if (!source.includes(compositionAnchor)) throw new Error("Proxy composition anchor not found");
  source = source.replace(compositionAnchor, composition);
}

const parentMarker = "\nasync function commandProxy(argv) {";
const poolMarker = "\nasync function commandProxyPool(argv) {";
if (source.split(parentMarker).length - 1 !== 1) {
  throw new Error("expected exactly one inline commandProxy");
}
if (source.split(poolMarker).length - 1 !== 1) {
  throw new Error("expected exactly one commandProxyPool");
}
const start = source.indexOf(parentMarker);
const end = source.indexOf(poolMarker, start + parentMarker.length);
if (start < 0 || end < 0 || end <= start) throw new Error("Proxy router boundaries not found");
source = source.slice(0, start) + "\n" + source.slice(end);

if (source.includes("async function commandProxy(argv) {")) {
  throw new Error("inline commandProxy still present");
}
if (!source.includes("async function commandProxyPool(argv) {")) {
  throw new Error("commandProxyPool was unexpectedly removed");
}
if (!source.includes("await commandProxy([subcommand, ...rest]);")) {
  throw new Error("top-level proxy route changed unexpectedly");
}
if (!source.includes("clashCommand: commandProxyClash")) {
  throw new Error("Proxy clash composition missing");
}
if (!source.includes("poolCommand: commandProxyPool")) {
  throw new Error("Proxy pool composition missing");
}

fs.writeFileSync(file, source);
