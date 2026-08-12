"use strict";

const BUILD_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    strategyVersion: { type: "integer" },
    dataVersion: { type: "string" },
    algorithmVersion: { type: "integer" },
    status: { type: "string" },
    signalCount: { type: "integer", minimum: 0 },
  },
  required: ["id", "strategyVersion", "dataVersion", "algorithmVersion", "status", "signalCount"],
});

const CANDIDATE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    rank: { type: ["integer", "null"], minimum: 1 },
    securityKey: { type: "string" },
    code: { type: "string" },
    market: { type: "number" },
    rankingValues: {
      type: "array",
      items: { type: ["number", "null"] },
    },
    qualityIssues: {
      type: "array",
      items: { type: "string" },
    },
    evidence: { type: "object" },
  },
  required: ["rank", "securityKey", "code", "market", "rankingValues", "qualityIssues"],
});

module.exports = {
  BUILD_SCHEMA,
  CANDIDATE_SCHEMA,
};
