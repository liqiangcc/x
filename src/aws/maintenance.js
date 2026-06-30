"use strict";

const DEFAULT_AWS_PROFILE = "default";
const DEFAULT_AWS_REGION = "ap-northeast-1";
const DEFAULT_LAMBDA_NAME = "kline";
const AWS_ACCESS_KEY_SECRET = "AWS_ACCESS_KEY_ID";
const AWS_SECRET_KEY_SECRET = "AWS_SECRET_ACCESS_KEY";
const AWS_REGION_VARIABLE = "AWS_REGION";

function normalizeAwsOptions(options = {}) {
  return {
    profile: String(options.profile ?? DEFAULT_AWS_PROFILE).trim() || DEFAULT_AWS_PROFILE,
    region: String(options.region ?? DEFAULT_AWS_REGION).trim() || DEFAULT_AWS_REGION,
    preflightRegion: String(options.preflightRegion ?? "").trim() || null,
    lambdaName: String(options.lambdaName ?? DEFAULT_LAMBDA_NAME).trim() || DEFAULT_LAMBDA_NAME,
  };
}

function sanitizeError(error) {
  const stderr = String(error?.stderr ?? "").trim();
  const message = stderr || error?.message || String(error);
  return message.replace(/\s+/g, " ").trim();
}

function awsProfileEnv(profile, env = process.env) {
  return {
    ...env,
    AWS_PROFILE: profile,
    AWS_SDK_LOAD_CONFIG: "1",
  };
}

async function readAwsConfigureValue(key, profile, execFileAsync) {
  try {
    const { stdout } = await execFileAsync("aws", [
      "configure",
      "get",
      key,
      "--profile",
      profile,
    ]);
    return String(stdout ?? "").trim();
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("aws CLI is not installed or not in PATH.");
    }
    return "";
  }
}

async function readAwsProfileCredentials({ profile = DEFAULT_AWS_PROFILE, execFileAsync }) {
  const accessKeyId = await readAwsConfigureValue("aws_access_key_id", profile, execFileAsync);
  const secretAccessKey = await readAwsConfigureValue("aws_secret_access_key", profile, execFileAsync);
  const sessionToken = await readAwsConfigureValue("aws_session_token", profile, execFileAsync);

  if (!accessKeyId) {
    throw new Error(`AWS profile ${profile} is missing aws_access_key_id.`);
  }
  if (!secretAccessKey) {
    throw new Error(`AWS profile ${profile} is missing aws_secret_access_key.`);
  }
  if (sessionToken) {
    throw new Error(
      `AWS profile ${profile} contains aws_session_token; use a long-lived IAM user access key for scheduled GitHub Actions.`
    );
  }

  return {
    accessKeyId,
    secretAccessKey,
    sessionToken,
  };
}

function summarizeCredentials(credentials) {
  return {
    access_key_id_present: Boolean(credentials?.accessKeyId),
    secret_access_key_present: Boolean(credentials?.secretAccessKey),
    session_token_present: Boolean(credentials?.sessionToken),
  };
}

async function getAwsCallerIdentity({ profile = DEFAULT_AWS_PROFILE, execFileAsync }) {
  const { stdout } = await execFileAsync("aws", [
    "sts",
    "get-caller-identity",
    "--profile",
    profile,
    "--output",
    "json",
  ]);
  const identity = JSON.parse(stdout);
  return {
    account: identity.Account ?? null,
    arn: identity.Arn ?? null,
    user_id: identity.UserId ?? null,
  };
}

async function getToolVersion(command, args, execFileAsync) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args);
    const output = String(stdout || stderr || "").split("\n")[0].trim();
    return {
      ok: true,
      version: output || "available",
    };
  } catch (error) {
    return {
      ok: false,
      error: sanitizeError(error),
    };
  }
}

function parseGitHubRepo(remoteUrl) {
  const trimmed = String(remoteUrl ?? "").trim();
  const patterns = [
    /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/,
    /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/,
    /^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) {
      return `${match[1]}/${match[2]}`;
    }
  }

  return null;
}

function assertGitHubRepo(repo) {
  const normalized = String(repo ?? "").trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized)) {
    throw new Error(`Invalid GitHub repo: ${repo}`);
  }
  return normalized;
}

async function resolveGitHubRepo({ repo = null, execFileAsync, cwd }) {
  if (repo) {
    return assertGitHubRepo(repo);
  }

  const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], { cwd });
  const parsed = parseGitHubRepo(stdout);
  if (!parsed) {
    throw new Error("Unable to infer GitHub repo from origin remote; pass --repo owner/name.");
  }
  return parsed;
}

function buildGithubSecretSetArgs(secretName, repo) {
  return ["secret", "set", secretName, "--repo", repo];
}

function buildGithubVariableSetArgs(variableName, value, repo) {
  return ["variable", "set", variableName, "--repo", repo, "--body", value];
}

module.exports = {
  AWS_ACCESS_KEY_SECRET,
  AWS_REGION_VARIABLE,
  AWS_SECRET_KEY_SECRET,
  DEFAULT_AWS_PROFILE,
  DEFAULT_AWS_REGION,
  DEFAULT_LAMBDA_NAME,
  assertGitHubRepo,
  awsProfileEnv,
  buildGithubSecretSetArgs,
  buildGithubVariableSetArgs,
  getAwsCallerIdentity,
  getToolVersion,
  normalizeAwsOptions,
  parseGitHubRepo,
  readAwsProfileCredentials,
  sanitizeError,
  summarizeCredentials,
  resolveGitHubRepo,
};
