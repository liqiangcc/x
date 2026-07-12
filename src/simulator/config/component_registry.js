"use strict";

const { assertNonEmptyString } = require("../core/contracts");

class ComponentRegistry {
  constructor() {
    this.components = new Map();
  }

  key(kind, id) {
    return `${assertNonEmptyString(kind, "kind")}:${assertNonEmptyString(id, "id")}`;
  }

  register(kind, id, factory) {
    if (typeof factory !== "function") {
      throw new TypeError("factory must be a function.");
    }
    const key = this.key(kind, id);
    if (this.components.has(key)) {
      throw new Error(`Component already registered: ${key}`);
    }
    this.components.set(key, factory);
    return this;
  }

  has(kind, id) {
    return this.components.has(this.key(kind, id));
  }

  create(kind, spec = {}, context = {}) {
    const id = assertNonEmptyString(spec.type, "spec.type");
    const key = this.key(kind, id);
    const factory = this.components.get(key);
    if (!factory) {
      const error = new Error(`Unknown component: ${key}`);
      error.code = "unknown_simulator_component";
      throw error;
    }
    return factory({ context, params: { ...spec, type: undefined } });
  }
}

module.exports = {
  ComponentRegistry,
};
