#!/usr/bin/env node

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const API_SCRIPT = path.resolve(__dirname, "../api/call_ttjj_api.sh");
const CONFIG_FILE = path.resolve(__dirname, "../config/kline.json");
const PERIOD_MAP = {
  daily: "101",
  yearly: "106",
};
const DEFAULT_AWS_REGIONS = [
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-northeast-3",
  "ap-south-1",
  "ap-southeast-1",
  "ap-southeast-2",
  "ca-central-1",
  "eu-central-1",
  "eu-north-1",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "sa-east-1",
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
];
const VALID_ENGINES = new Set(["auto", "local", "aws"]);

function printUsage() {
  console.error(
    "Usage: node fetch/fetch_kline.js <code_or_secid> [--period <daily|yearly>] [--engine <auto|local|aws>] [--aws-region <r1,r2,...>] [--lambda-name <name>] [--config <file>] [--output <file>]"
  );
}

function parseArguments(argv) {
  const options = {
    awsRegions: [...DEFAULT_AWS_REGIONS],
    awsRegionsOverridden: false,
    configFile: CONFIG_FILE,
    engine: "auto",
    input: null,
    lambdaName: "kline",
    lambdaNameOverridden: false,
    outputFile: null,
    period: "daily",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--period") {
      const nextArg = argv[index + 1];
      if (!nextArg || !Object.prototype.hasOwnProperty.call(PERIOD_MAP, nextArg)) {
        throw new Error(`Invalid value for --period: ${nextArg ?? ""}`);
      }
      options.period = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--engine") {
      const nextArg = argv[index + 1];
      if (!nextArg || !VALID_ENGINES.has(nextArg)) {
        throw new Error(`Invalid value for --engine: ${nextArg ?? ""}`);
      }
      options.engine = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--aws-region") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --aws-region.");
      }
      const regions = nextArg
        .split(",")
        .map((region) => region.trim())
        .filter(Boolean);
      if (regions.length === 0) {
        throw new Error("No valid AWS regions were provided.");
      }
      options.awsRegions = regions;
      options.awsRegionsOverridden = true;
      index += 1;
      continue;
    }

    if (arg === "--lambda-name") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --lambda-name.");
      }
      options.lambdaName = nextArg;
      options.lambdaNameOverridden = true;
      index += 1;
      continue;
    }

    if (arg === "--config") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --config.");
      }
      options.configFile = path.resolve(nextArg);
      index += 1;
      continue;
    }

    if (arg === "--output" || arg === "-o") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --output.");
      }
      options.outputFile = path.resolve(nextArg);
      index += 1;
      continue;
    }

    if (options.input) {
      throw new Error("Only one code_or_secid is supported.");
    }
    options.input = arg;
  }

  if (!options.input) {
    printUsage();
    process.exitCode = 1;
    return null;
  }

  return options;
}

async function applyConfigDefaults(options) {
  try {
    const raw = await fs.readFile(options.configFile, "utf8");
    const config = JSON.parse(raw);

    if (!options.awsRegionsOverridden && Array.isArray(config?.aws_regions) && config.aws_regions.length > 0) {
      options.awsRegions = config.aws_regions
        .map((region) => String(region).trim())
        .filter(Boolean);
    }

    if (!options.lambdaNameOverridden && typeof config?.lambda_name === "string" && config.lambda_name.trim()) {
      options.lambdaName = config.lambda_name.trim();
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      return options;
    }
    throw new Error(`Failed to load config ${options.configFile}: ${error.message}`);
  }

  return options;
}

function inferSecid(input) {
  if (/^\d+\.[A-Za-z0-9]+$/.test(input)) {
    return input;
  }
  if (/^6\d{5}$/.test(input)) {
    return `1.${input}`;
  }
  if (/^[03]\d{5}$/.test(input)) {
    return `0.${input}`;
  }
  if (/^9\d{5}$/.test(input)) {
    return `0.${input}`;
  }
  throw new Error(`Unable to infer secid from input: ${input}`);
}

async function fetchLocalKline(secid, klt) {
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const { stdout } = await execFileAsync(
        API_SCRIPT,
        ["get_kline", secid, klt, "100000", "20991231"],
        { maxBuffer: 20 * 1024 * 1024 }
      );
      return JSON.parse(stdout);
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => {
          setTimeout(resolve, attempt * 500);
        });
      }
    }
  }

  throw lastError;
}

async function invokeAwsRegion(secid, klt, awsRegion, lambdaName) {
  const payload = JSON.stringify({
    secid,
    klt: Number(klt),
    lmt: 100000,
    dry_run: true,
    format: "json",
    debug: false,
    end: "20991231",
  });

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kline-lambda-"));
  const outputFile = path.join(tempDir, "payload.json");

  try {
    const { stdout } = await execFileAsync(
      "aws",
      [
        "lambda",
        "invoke",
        "--function-name",
        lambdaName,
        "--region",
        awsRegion,
        "--cli-binary-format",
        "raw-in-base64-out",
        "--payload",
        payload,
        outputFile,
      ],
      { maxBuffer: 20 * 1024 * 1024 }
    );

    const meta = JSON.parse(stdout);
    const rawPayload = await fs.readFile(outputFile, "utf8");
    const invokePayload = JSON.parse(rawPayload);

    if (meta.FunctionError) {
      throw new Error(`Lambda function error: ${meta.FunctionError}`);
    }

    if (invokePayload.statusCode !== 200) {
      throw new Error(`Lambda returned statusCode ${invokePayload.statusCode}: ${invokePayload.body ?? ""}`);
    }

    return typeof invokePayload.body === "string"
      ? JSON.parse(invokePayload.body)
      : invokePayload.body;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function normalizeKlineData(rawData, secid, sourceEngine, sourceRegion = null) {
  if (Array.isArray(rawData?.data?.klines)) {
    return {
      ...rawData,
      source_engine: sourceEngine,
      source_region: sourceRegion,
    };
  }

  if (Array.isArray(rawData?.data)) {
    const code = secid.includes(".") ? secid.split(".")[1] : secid;
    const market = secid.includes(".") ? Number(secid.split(".")[0]) : null;
    const klines = rawData.data.map((item) =>
      [
        item.f51,
        item.f52,
        item.f53,
        item.f54,
        item.f55,
        item.f56,
        item.f57,
        item.f58,
        item.f59,
        item.f60,
        item.f61,
      ].join(",")
    );

    return {
      rc: 0,
      source_engine: sourceEngine,
      source_region: sourceRegion,
      meta: rawData.meta ?? null,
      data: {
        code,
        market,
        klines,
      },
    };
  }

  return {
    ...rawData,
    source_engine: sourceEngine,
    source_region: sourceRegion,
  };
}

async function fetchAwsKline(secid, klt, awsRegions, lambdaName) {
  let lastError;

  for (const region of awsRegions) {
    try {
      const rawData = await invokeAwsRegion(secid, klt, region, lambdaName);
      return normalizeKlineData(rawData, secid, "aws", region);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

async function resolveKline(options) {
  const secid = inferSecid(options.input);
  const klt = PERIOD_MAP[options.period];

  if (options.engine === "local") {
    const rawData = await fetchLocalKline(secid, klt);
    return normalizeKlineData(rawData, secid, "local");
  }

  if (options.engine === "aws") {
    return fetchAwsKline(secid, klt, options.awsRegions, options.lambdaName);
  }

  let awsError = null;
  try {
    return await fetchAwsKline(secid, klt, options.awsRegions, options.lambdaName);
  } catch (error) {
    awsError = error;
  }

  try {
    const rawData = await fetchLocalKline(secid, klt);
    return normalizeKlineData(rawData, secid, "local");
  } catch (localError) {
    const message = [
      `AWS failed: ${awsError?.message ?? "unknown error"}`,
      `Local failed: ${localError.message}`,
    ].join(" | ");
    throw new Error(message);
  }
}

async function main() {
  const cliOptions = parseArguments(process.argv.slice(2));
  if (!cliOptions) {
    return;
  }

  const options = await applyConfigDefaults(cliOptions);
  if (!options) {
    return;
  }

  const data = await resolveKline(options);
  const output = `${JSON.stringify(data, null, 2)}\n`;

  if (options.outputFile) {
    await fs.mkdir(path.dirname(options.outputFile), { recursive: true });
    await fs.writeFile(options.outputFile, output, "utf8");
    console.log(options.outputFile);
    return;
  }

  process.stdout.write(output);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
