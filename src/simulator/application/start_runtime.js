"use strict";

const {
  assertSimulatorRuntimeLauncher,
} = require("../ports/runtime_launcher");

class StartSimulatorRuntimeUseCase {
  constructor({ runtimeLauncher }) {
    this.runtimeLauncher = assertSimulatorRuntimeLauncher(runtimeLauncher);
  }

  async execute({ host, port }) {
    return this.runtimeLauncher.launch({ host, port });
  }
}

module.exports = {
  StartSimulatorRuntimeUseCase,
};
