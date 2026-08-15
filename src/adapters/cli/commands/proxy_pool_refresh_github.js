"use strict";

const { parseCliOptions } = require("../option_parser");

function parseProxyPoolRefreshGithubOptions(argv, defaults = {}) {
  return parseCliOptions(argv, defaults);
}

function parsePositiveOption(value, name, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return number;
}

function requireProvider(provider) {
  if (!provider || typeof provider.listCandidates !== "function") {
    throw new TypeError("proxy pool refresh-github provider must expose listCandidates().");
  }
  return provider;
}

async function runProxyPoolRefreshGithubCommand({
  argv = [],
  provider,
  createProvider,
  stdout = process.stdout,
} = {}) {
  const options = parseProxyPoolRefreshGithubOptions(argv);
  const providerOptions = {
    filePath: options.path,
    ref: options.ref,
    repository: options.repository,
    timeoutMs: parsePositiveOption(options.timeoutMs, "--timeout-ms", 5000),
  };

  const resolvedProvider = requireProvider(
    provider ?? createProvider?.(providerOptions),
  );
  const proxies = await resolvedProvider.listCandidates();
  const report = {
    ok: true,
    ...resolvedProvider.lastReport,
    candidate_count: proxies.length,
  };
  stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function createProxyPoolRefreshGithubCommand({
  stdout = process.stdout,
  provider,
  createProvider,
} = {}) {
  function resolveProvider(options) {
    if (provider) {
      return provider;
    }
    if (createProvider) {
      return createProvider(options);
    }
    const {
      GithubProxyRepositoryProvider,
    } = require("../../../proxy/providers/github_repository");
    return new GithubProxyRepositoryProvider(options);
  }

  return (argv = []) => runProxyPoolRefreshGithubCommand({
    argv,
    createProvider: resolveProvider,
    stdout,
  });
}

module.exports = {
  createProxyPoolRefreshGithubCommand,
  parsePositiveOption,
  parseProxyPoolRefreshGithubOptions,
  runProxyPoolRefreshGithubCommand,
};
