"use strict";

class CapabilityRegistry {
  constructor(kind) {
    this.kind = kind;
    this.values = new Map();
  }

  register(descriptor) {
    if (!descriptor?.id || typeof descriptor.id !== "string") throw new TypeError(`${this.kind} capability requires an id.`);
    if (this.values.has(descriptor.id)) throw new TypeError(`Duplicate ${this.kind} capability: ${descriptor.id}`);
    this.values.set(descriptor.id, Object.freeze({ ...descriptor }));
    return this;
  }

  get(id) {
    const descriptor = this.values.get(id);
    if (!descriptor) {
      const error = new Error(`Unknown ${this.kind} capability: ${id}`);
      error.code = `unknown_${this.kind}_capability`;
      error.statusCode = 422;
      throw error;
    }
    return descriptor;
  }

  list() {
    return [...this.values.values()];
  }
}

function createCapabilityRegistries() {
  return {
    features: new CapabilityRegistry("feature"),
    indicators: new CapabilityRegistry("indicator"),
    rules: new CapabilityRegistry("rule"),
  };
}

module.exports = { CapabilityRegistry, createCapabilityRegistries };
