"use strict";

function createEngine(name, fetchKline) {
  return { name, fetchKline };
}

function createEngineRegistry(implementations) {
  return Object.fromEntries(Object.entries(implementations).map(([name, fetchKline]) => [name, createEngine(name, fetchKline)]));
}

module.exports = { createEngine, createEngineRegistry };
