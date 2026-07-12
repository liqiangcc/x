"use strict";

const { expect, test } = require("@playwright/test");

const CANDIDATE = {
  alias: "候选A",
  candidateId: "cand_safe",
  evidence: {
    annual_points: [
      { close: 20, high: 24, year: 2022 },
      { close: 18, high: 22, year: 2023 },
      { close: 16, high: 20, year: 2024 },
      { close: 14, high: 17, year: 2025 },
    ],
    breakout_margin_pct: 1.18,
    max_previous_current_year_close: 16.8,
    previous_year_high: 17,
    today_close: 17.2,
  },
  qualityIssues: ["market_rule_approximation"],
  rank: 1,
};

function session(version = 1, status = "waiting_for_decision", date = "2026-07-01") {
  return {
    account: { cash: 100000, cashAvailable: 100000, equity: 100000, frozenCash: 0, marketValue: 0, positions: [], realizedPnl: 0, totalFees: 0, unrealizedPnl: 0 },
    candidateSnapshot: { candidates: [CANDIDATE] },
    clock: { currentDate: date, nextDate: date === "2026-07-01" ? "2026-07-02" : "2026-07-03" },
    config: { selection: {} },
    dataMode: "legacy_approximate",
    id: "session-safe",
    mode: "manual",
    status,
    version,
  };
}

async function mockApi(page) {
  let current = session();
  await page.route("**/api/sessions**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    let body;
    if (path === "/api/sessions" && request.method() === "POST") body = current;
    else if (path.endsWith("/candidates")) body = { dataMode: "legacy_approximate", pagination: { items: [CANDIDATE], page: 1, pageSize: 20, total: 1, totalPages: 1, viewAll: false } };
    else if (path.includes("/chart/")) body = {
      alias: "候选A",
      candidateId: "cand_safe",
      daily: Array.from({ length: 24 }, (_, index) => ({ bollLower: 14 + index * 0.05, bollMiddle: 15 + index * 0.05, bollUpper: 16 + index * 0.05, breakout: index === 23, close: 15 + index * 0.1, date: `2026-06-${String(index + 1).padStart(2, "0")}`, high: 15.3 + index * 0.1, low: 14.7 + index * 0.1, open: 14.9 + index * 0.1, previousYearHigh: 17, volume: 1000 + index })),
      yearly: [2022, 2023, 2024, 2025].map((year, index) => ({ close: 20 - index * 2, high: 24 - index * 2, low: 18 - index * 2, open: 21 - index * 2, year })),
    };
    else if (path.endsWith("/portfolio")) body = current.account;
    else if (path.endsWith("/orders") && request.method() === "POST") {
      current = { ...current, version: current.version + 1, account: { ...current.account, cashAvailable: 98265, frozenCash: 1735 } };
      body = { order: { candidateId: "cand_safe", id: "order-safe", quantity: 100, reason: "首次突破练习", side: "buy", status: "accepted" }, sessionVersion: current.version };
    } else if (path.endsWith("/complete-decision")) {
      current = { ...current, status: "running", version: current.version + 1 };
      body = current;
    } else if (path.endsWith("/advance")) {
      current = { ...current, clock: { currentDate: "2026-07-02", nextDate: "2026-07-03" }, status: "waiting_for_decision", version: current.version + 1 };
      body = current;
    } else body = { error: { code: "not_mocked", issues: [], message: path } };
    await route.fulfill({ body: JSON.stringify(body), contentType: "application/json", status: 200 });
  });
}

test("responsive core flow has usable touch targets and no page overflow", async ({ page }, testInfo) => {
  await mockApi(page);
  await page.goto("/create");
  await page.getByRole("button", { name: "开始匿名练习" }).click();
  await expect(page.getByRole("heading", { name: "匿名候选池" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "候选A" })).toBeVisible();
  await page.getByRole("button", { name: "查看走势并交易" }).click();
  await expect(page.getByRole("img", { name: "日线及 BOLL 图表" })).toBeVisible();

  await page.getByLabel("交易理由").fill("首次突破练习");
  await page.getByRole("button", { name: "预览订单" }).click();
  await expect(page.getByRole("dialog", { name: "确认订单" })).toContainText("冻结资金");
  await page.getByRole("button", { name: "确认提交" }).click();
  await expect(page.getByText("首次突破练习").last()).toBeVisible();

  const isMobile = testInfo.project.name.startsWith("mobile");
  const complete = page.getByRole("button", { name: "完成决策" });
  await complete.last().click();
  const advance = page.getByRole("button", { name: "推进到下一交易日" });
  await expect(advance.last()).toBeVisible();
  await advance.last().click();
  await expect(page.getByText("截至 2026-07-02")).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  if (isMobile) {
    const sizes = await page.locator("button:visible, a:visible").evaluateAll((elements) => elements.map((element) => ({ height: element.getBoundingClientRect().height, text: element.textContent.trim() })));
    expect(sizes.filter((item) => item.text).every((item) => item.height >= 43)).toBeTruthy();
  }
  const brand = page.getByRole("link", { name: "历史交易练习" });
  await brand.focus();
  await expect(brand).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "创建" })).toBeFocused();
});

test("mobile chart remains usable in landscape", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "mobile-only landscape check");
  await mockApi(page);
  await page.setViewportSize({ height: 390, width: 844 });
  await page.goto("/create");
  await page.getByRole("button", { name: "开始匿名练习" }).click();
  await page.getByRole("button", { name: "查看走势并交易" }).click();
  const chart = page.getByRole("img", { name: "日线及 BOLL 图表" });
  await expect(chart).toBeVisible();
  expect((await chart.boundingBox()).height).toBeGreaterThanOrEqual(290);
});
