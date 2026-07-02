"use strict";

const { evaluateFirstCross } = require("./first_cross");
const { evaluatePoolMembership } = require("./pool_membership");
const { evaluateQualityGate } = require("./quality_gate");
const { evaluateRatioCompare } = require("./ratio_compare");
const { evaluateTrendAlignment } = require("./trend_alignment");
const { getPathValue, numberAtPath } = require("./utils");

const CapabilityType = Object.freeze({
  FIRST_CROSS: "first_cross",
  POOL_MEMBERSHIP: "pool_membership",
  QUALITY_GATE: "quality_gate",
  RATIO_COMPARE: "ratio_compare",
  SEQUENCE_PATTERN: "sequence_pattern",
  TREND_ALIGNMENT: "trend_alignment",
  VALUE_COMPARE: "value_compare",
  WINDOW_AVERAGE: "window_average",
  WINDOW_EXTREME: "window_extreme",
});

const EVALUATORS = {
  [CapabilityType.FIRST_CROSS]: evaluateFirstCross,
  [CapabilityType.POOL_MEMBERSHIP]: evaluatePoolMembership,
  [CapabilityType.QUALITY_GATE]: evaluateQualityGate,
  [CapabilityType.RATIO_COMPARE]: evaluateRatioCompare,
  [CapabilityType.TREND_ALIGNMENT]: evaluateTrendAlignment,
};

function evaluateCapability(type, context, params = {}) {
  const evaluator = EVALUATORS[type];
  if (!evaluator) {
    throw new Error(`Unsupported signal capability: ${type}`);
  }
  return evaluator(context, params);
}

module.exports = {
  CapabilityType,
  evaluateCapability,
  getPathValue,
  numberAtPath,
};
