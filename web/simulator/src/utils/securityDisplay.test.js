import { describe, expect, it } from "vitest";
import { accountLabel, candidateMarketBoard, securityLabel, tradingDayLabel } from "./securityDisplay.js";

describe("securityLabel", () => {
  const item = { alias: "候选A", security: { code: "600519", market: 1, name: "贵州茅台" } };

  it("uses the stable alias in anonymous mode", () => {
    expect(securityLabel(item, true)).toBe("候选A");
  });

  it("restores the real name and code when anonymous mode is disabled", () => {
    expect(securityLabel(item, false)).toBe("贵州茅台 / 600519");
  });

  it("shows real dates only when anonymous mode is disabled", () => {
    expect(tradingDayLabel({ anonymousMode: true, date: "2026-07-13", dayIndex: 8 })).toBe("第 8 个交易日");
    expect(tradingDayLabel({ anonymousMode: false, date: "2026-07-13", dayIndex: 8 })).toBe("2026-07-13 · 第 8 个交易日");
  });

  it("hides account names that may contain a real year in anonymous mode", () => {
    expect(accountLabel({ name: "2026" }, true)).toBe("练习账号");
    expect(accountLabel({ name: "2026" }, true, 2)).toBe("练习账号 3");
    expect(accountLabel({ name: "2026" }, false)).toBe("2026");
  });

  it("classifies candidate boards for temporary filters", () => {
    expect(candidateMarketBoard({ security: { code: "688001" } })).toBe("starMarket");
    expect(candidateMarketBoard({ security: { code: "920001" } })).toBe("beijingExchange");
    expect(candidateMarketBoard({ security: { code: "300001" } })).toBe("chiNext");
    expect(candidateMarketBoard({ security: { code: "600001" } })).toBe("mainBoard");
  });
});
