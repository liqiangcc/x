"use strict";

const { evaluateCapability } = require("./capabilities");
const { yearBreakoutSignal } = require("./signals/breakout");
const { poolSignals } = require("./signals/pool");
const { trendConfirmedSignal } = require("./signals/trend");
const { volumeExpandSignal } = require("./signals/volume");

const DEFAULT_SIGNAL_REGISTRY = [
  ...poolSignals,
  yearBreakoutSignal,
  volumeExpandSignal,
  trendConfirmedSignal,
];

function evaluateSignal(definition, context) {
  const capabilityResult = evaluateCapability(definition.capability, context, definition.params);
  const evidence = typeof definition.formatEvidence === "function"
    ? definition.formatEvidence(context, capabilityResult)
    : capabilityResult.evidence;

  return {
    category: definition.category,
    evidence,
    id: definition.id,
    ok: capabilityResult.ok,
    qualityIssues: capabilityResult.qualityIssues ?? [],
    score: capabilityResult.ok ? definition.defaultScore : 0,
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
