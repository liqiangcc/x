"use strict";

const { CapabilityType } = require("../capabilities");

function poolSignal(id, pool, defaultScore) {
  return {
    capability: CapabilityType.POOL_MEMBERSHIP,
    category: "pool",
    defaultScore,
    id,
    params: { pool },
  };
}

module.exports = {
  poolSignals: [
    poolSignal("limit_up_pool", "zt", 50),
    poolSignal("strong_pool", "qs", 30),
    poolSignal("limit_break_pool", "zb", 15),
  ],
};
