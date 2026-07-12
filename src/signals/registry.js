"use strict";

const { evaluateCapability } = require("./capabilities");
const { yearBreakoutSignal } = require("./signals/breakout");
const { poolSignals } = require("./signals/pool");
const { trendConfirmedSignal } = require("./signals/trend");
const { volumeExpandSignal } = require("./signals/volume");
const { yearDowntrendReversalSignal } = require("./signals/year_reversal");
const { yearDeclineCloseBreakoutSignal } = require("./signals/year_decline_close_breakout");

const DEFAULT_SIGNAL_REGISTRY = [
  ...poolSignals,
  yearBreakoutSignal,
  yearDeclineCloseBreakoutSignal,
  yearDowntrendReversalSignal,
  volumeExpandSignal,
  trendConfirmedSignal,
];

function signalCapabilities(definition) {
  if (Array.isArray(definition.capabilities) && definition.capabilities.length > 0) {
    return definition.capabilities;
  }
  return [{
    capability: definition.capability,
    params: definition.params,
  }];
}

function evaluateSignal(definition, context) {
  if (typeof definition.evaluate === "function") {
    const result = definition.evaluate(context);
    return {
      category: definition.category,
      evidence: result.evidence,
      id: definition.id,
      ok: result.ok,
      qualityIssues: result.qualityIssues ?? [],
      score: result.ok ? definition.defaultScore : 0,
    };
  }

  const capabilityResults = signalCapabilities(definition).map((item) => evaluateCapability(item.capability, context, item.params));
  const ok = capabilityResults.every((result) => result.ok);
  const evidenceInput = capabilityResults.length === 1 ? capabilityResults[0] : capabilityResults;
  const evidence = typeof definition.formatEvidence === "function"
    ? definition.formatEvidence(context, evidenceInput)
    : (capabilityResults.length === 1 ? capabilityResults[0].evidence : capabilityResults.map((result) => result.evidence));

  return {
    category: definition.category,
    evidence,
    id: definition.id,
    ok,
    qualityIssues: capabilityResults.flatMap((result) => result.qualityIssues ?? []),
    score: ok ? definition.defaultScore : 0,
  };
}

function runSignals(context, registry = DEFAULT_SIGNAL_REGISTRY) {
  return registry.map((definition) => evaluateSignal(definition, context));
}

module.exports = {
  DEFAULT_SIGNAL_REGISTRY,
  evaluateSignal,
  runSignals,
};
