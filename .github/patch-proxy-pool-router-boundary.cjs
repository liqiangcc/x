"use strict";

const fs = require("node:fs");

const file = "bin/x";
let source = fs.readFileSync(file, "utf8");

const proxyImport = 'const { createProxyCommand } = require("../src/adapters/cli/commands/proxy");\n';
const poolImport = 'const { createProxyPoolCommand } = require("../src/adapters/cli/commands/proxy_pool");\n';
if (!source.includes(poolImport)) {
  if (!source.includes(proxyImport)) throw new Error("Proxy parent import anchor not found");
  source = source.replace(proxyImport, proxyImport + poolImport);
}

const oldParentComposition = [
  "const commandProxyClash = createProxyClashCommand();",
  "const commandProxy = createProxyCommand({",
  "  clashCommand: commandProxyClash,",
  "  poolCommand: commandProxyPool,",
  "});",
  "const commandProxyPoolVerify = createProxyPoolVerifyCommand({ root: ROOT, runsDir: DEFAULT_RUNS_DIR });",
].join("\n");
const childCompositionStart = [
  "const commandProxyClash = createProxyClashCommand();",
  "const commandProxyPoolVerify = createProxyPoolVerifyCommand({ root: ROOT, runsDir: DEFAULT_RUNS_DIR });",
].join("\n");
if (source.includes(oldParentComposition)) {
  source = source.replace(oldParentComposition, childCompositionStart);
} else if (!source.includes(childCompositionStart)) {
  throw new Error("Proxy composition start anchor not found");
}

const warmupAnchor = [
  "const commandProxyPoolWarmup = createProxyPoolWarmupCommand({",
  "  root: ROOT,",
  "  runsDir: DEFAULT_RUNS_DIR,",
  "  reportWriter: proxyBenchmarkReportWriter,",
  "});",
  "const commandDb = createDbCommand();",
].join("\n");
const routerComposition = [
  "const commandProxyPoolWarmup = createProxyPoolWarmupCommand({",
  "  root: ROOT,",
  "  runsDir: DEFAULT_RUNS_DIR,",
  "  reportWriter: proxyBenchmarkReportWriter,",
  "});",
  "const commandProxyPool = createProxyPoolCommand({",
  "  verifyCommand: commandProxyPoolVerify,",
  "  selectCommand: commandProxyPoolSelect,",
  "  statusCommand: commandProxyPoolStatus,",
  "  refreshGithubCommand: commandProxyPoolRefreshGithub,",
  "  lifecycleCommand: commandProxyPoolLifecycle,",
  "  diagnoseCommand: commandProxyPoolDiagnose,",
  "  probeCommand: commandProxyPoolProbe,",
  "  benchmarkCommand: commandProxyPoolBenchmark,",
  "  warmupCommand: commandProxyPoolWarmup,",
  "});",
  "const commandProxy = createProxyCommand({",
  "  clashCommand: commandProxyClash,",
  "  poolCommand: commandProxyPool,",
  "});",
  "const commandDb = createDbCommand();",
].join("\n");
if (!source.includes("const commandProxyPool = createProxyPoolCommand({")) {
  if (!source.includes(warmupAnchor)) throw new Error("Proxy pool warmup composition anchor not found");
  source = source.replace(warmupAnchor, routerComposition);
}

const parentMarker = "\nasync function commandProxyPool(argv) {";
const nextMarker = "\nfunction printDailyRunSummary";
const count = source.split(parentMarker).length - 1;
if (count !== 1) throw new Error(`expected exactly one inline commandProxyPool, found ${count}`);
const start = source.indexOf(parentMarker);
const end = source.indexOf(nextMarker, start + parentMarker.length);
if (start < 0 || end < 0 || end <= start) throw new Error("Proxy pool router boundaries not found");
source = source.slice(0, start) + "\n" + source.slice(end);

const dependencies = [
  "verifyCommand: commandProxyPoolVerify",
  "selectCommand: commandProxyPoolSelect",
  "statusCommand: commandProxyPoolStatus",
  "refreshGithubCommand: commandProxyPoolRefreshGithub",
  "lifecycleCommand: commandProxyPoolLifecycle",
  "diagnoseCommand: commandProxyPoolDiagnose",
  "probeCommand: commandProxyPoolProbe",
  "benchmarkCommand: commandProxyPoolBenchmark",
  "warmupCommand: commandProxyPoolWarmup",
];

if (source.includes("async function commandProxyPool(argv) {")) {
  throw new Error("inline commandProxyPool still present");
}
if (!source.includes(poolImport.trim())) throw new Error("Proxy pool router import missing");
if (!source.includes("const commandProxyPool = createProxyPoolCommand({")) {
  throw new Error("Proxy pool router composition missing");
}
for (const dependency of dependencies) {
  if (!source.includes(dependency)) throw new Error(`Proxy pool dependency missing: ${dependency}`);
}
const poolIndex = source.indexOf("const commandProxyPool = createProxyPoolCommand({");
const proxyIndex = source.indexOf("const commandProxy = createProxyCommand({");
if (poolIndex < 0 || proxyIndex <= poolIndex) {
  throw new Error("Proxy parent must be composed after Proxy Pool router");
}
if (!source.includes("poolCommand: commandProxyPool")) throw new Error("Proxy parent pool dependency missing");
if (!source.includes("await commandProxy([subcommand, ...rest]);")) {
  throw new Error("top-level proxy route changed unexpectedly");
}

fs.writeFileSync(file, source);
