"use strict";

function stripJsonp(rawText) {
  const trimmed = String(rawText ?? "").trim();
  const match = trimmed.match(/^[\w$.]+\(([\s\S]*)\);?$/);
  if (match) {
    return match[1].trim();
  }
  return trimmed;
}

function parseJsonOrJsonp(rawText) {
  return JSON.parse(stripJsonp(rawText));
}

module.exports = {
  parseJsonOrJsonp,
  stripJsonp,
};
