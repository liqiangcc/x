"use strict";

const { inferSecid } = require("../../core/secid");
const {
  assertRouterProbeClient,
} = require("../../ports/aws/router_probe_client");

function periodToKlt(period = "daily") {
  if (period === "daily") return 101;
  if (period === "yearly") return 106;
  throw new Error(`Invalid period: ${period}`);
}

function buildRouterProbeRequest({
  end = "20991231",
  lmt = null,
  period = "daily",
  secid,
  targetRegion = "all",
} = {}) {
  if (!secid) {
    throw new Error("aws probe-router requires --secid <secid_or_code>.");
  }
  return {
    region: targetRegion ?? "all",
    secid: inferSecid(secid),
    klt: periodToKlt(period ?? "daily"),
    lmt: lmt ? Number(lmt) : 1,
    end: end ?? "20991231",
  };
}

class ProbeAwsRouterUseCase {
  constructor({ routerProbeClient } = {}) {
    this.routerProbeClient = assertRouterProbeClient(routerProbeClient);
  }

  async execute(request = {}) {
    return this.routerProbeClient.probe(buildRouterProbeRequest(request));
  }
}

module.exports = {
  ProbeAwsRouterUseCase,
  buildRouterProbeRequest,
  periodToKlt,
};
