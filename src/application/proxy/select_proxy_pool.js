"use strict";

const {
  buildProxySelectionReport,
  retainPreviousProxySelection,
  selectHealthyProxies,
} = require("../../proxy/selection");
const {
  assertProxyHealthStateReader,
  assertProxySelectionReportStore,
} = require("../../ports/proxy/proxy_selection");

class SelectProxyPoolUseCase {
  constructor({ healthStateReader, reportStore, now = () => new Date().toISOString() } = {}) {
    this.healthStateReader = assertProxyHealthStateReader(healthStateReader);
    this.reportStore = assertProxySelectionReportStore(reportStore);
    this.now = now;
  }

  async execute({ output = null, ...policy } = {}) {
    const state = await this.healthStateReader.read();
    const proxies = selectHealthyProxies(state, policy);

    if (proxies.length === 0) {
      const previous = await this.reportStore.readPrevious({ output });
      if (previous) {
        return {
          ...retainPreviousProxySelection(previous.report),
          output: previous.output,
        };
      }
    }

    const report = buildProxySelectionReport({
      generatedAt: this.now(),
      options: policy,
      proxies,
    });
    const stored = await this.reportStore.write({ output, report });
    return { ...report, output: stored.output };
  }
}

module.exports = {
  SelectProxyPoolUseCase,
};
