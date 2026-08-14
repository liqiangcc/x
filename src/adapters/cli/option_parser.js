"use strict";

const BOOLEAN_OPTIONS = Object.freeze(new Set([
  "latest",
  "commit",
  "force",
  "forcePool",
  "forceUniverse",
  "forceStrategyCodes",
  "strategyOnly",
  "allCodes",
  "json",
  "allowPartial",
  "proxyPreflight",
  "noProxyPreflight",
]));

function parseCliOptions(argv, defaults = {}) {
  const options = { _: [], ...defaults };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      options._.push(arg);
      continue;
    }

    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    if (BOOLEAN_OPTIONS.has(key)) {
      options[key] = true;
      continue;
    }

    const nextArg = argv[index + 1];
    if (!nextArg) {
      throw new Error(`Missing value for ${arg}`);
    }
    options[key] = nextArg;
    index += 1;
  }
  return options;
}

module.exports = {
  BOOLEAN_OPTIONS,
  parseCliOptions,
};
