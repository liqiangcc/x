"use strict";

const { expect, test } = require("@playwright/test");

const CANDIDATE = {
  alias: "候选A",
  candidateId: "cand_flow",
  evidence: { breakout_margin_pct: 1.18, previous_year_high: 17, today_close: 17.2 },
  qualityIssues: [],
  rank: 1,
};

function account(availableQuantity = null) {
  return {
    cash: 100000,
    cashAvailable: 100000,
    equity: 100000,
    frozenCash: 0,
    marketValue: availableQuantity === null ? 0 : 1760,
    positions: availableQuantity === null ? [] : [{ alias: "候选A", availableQuantity, averageCost: 17.37, candidateId: "cand_flow", marketValue: 1760, quantity: 100, unrealizedPnl: 23 }],
    realizedPnl: 0,
    totalFees: availableQuantity === null ? 0 : 5,
    unrealizedPnl: availableQuantity === null ? 0 : 23,
  };
}

function state() {
  return {
    account: account(),
    candidateSnapshot: { candidates: [CANDIDATE] },
    clock: { currentDate: "2026-07-01", nextDate: "2026-07-02" },
    config: { selection: {} },
    dataMode: "legacy_approximate",
    id: "flow-parent",
    mode: "manual",
    status: "waiting_for_decision",
    version: 1,
  };
}

async function installFixedMarket(page) {
  let current = state();
  const orders = [];
  await page.route("**/api/sessions**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const payload = request.postData() ? request.postDataJSON() : {};
    let body;
    if (path === "/api/sessions" && request.method() === "POST") body = current;
    else if (path.endsWith("/candidates")) body = { pagination: { items: [CANDIDATE], page: 1, pageSize: 20, total: 1, totalPages: 1 } };
    else if (path.includes("/chart/")) body = { alias: CANDIDATE.alias, candidateId: CANDIDATE.candidateId, daily: [{ bollLower: 15, bollMiddle: 16, bollUpper: 17, close: 17.2, date: current.clock.currentDate, high: 17.4, low: 16.7, open: 16.9, volume: 1000 }], yearly: [{ close: 14, high: 17, low: 12, open: 16, year: 2025 }] };
    else if (path.endsWith("/portfolio")) body = current.account;
    else if (path.endsWith("/orders") && request.method() === "POST") {
      const order = { ...payload, id: `order-${orders.length + 1}`, status: "accepted", tradingDate: current.clock.currentDate };
      orders.push(order);
      current = { ...current, version: current.version + 1 };
      body = { order, sessionVersion: current.version };
    } else if (path.endsWith("/complete-decision")) {
      current = { ...current, status: "running", version: current.version + 1 };
      body = current;
    } else if (path.endsWith("/advance")) {
      const firstAdvance = current.clock.currentDate === "2026-07-01";
      current = {
        ...current,
        account: account(firstAdvance ? 0 : 100),
        clock: { currentDate: firstAdvance ? "2026-07-02" : "2026-07-03", nextDate: firstAdvance ? "2026-07-03" : "2026-07-06" },
        status: "waiting_for_decision",
        version: current.version + 1,
      };
      body = current;
    } else if (path.endsWith("/finish")) {
      current = { ...current, status: "completed", version: current.version + 1 };
      body = current;
    } else if (path.endsWith("/reveal")) {
      current = { ...current, revealedAt: "2026-07-12T00:00:00Z", version: current.version + 1 };
      body = { identities: [{ alias: "候选A", candidateId: "cand_flow", code: "600001", market: 1 }], revealedAt: current.revealedAt, sessionVersion: current.version };
    } else if (path.endsWith("/export")) body = { filePath: "var/simulator/exports/flow-parent.json" };
    else if (path.endsWith("/clone")) {
      body = { ...state(), config: { selection: payload.selection }, id: "flow-child", lineage: { branchDate: current.clock.currentDate, parentSessionId: "flow-parent" }, selectionEffectiveDate: current.clock.nextDate };
      current = body;
    } else if (path.endsWith("/report")) body = {
      account: current.account,
      benchmark: { status: "benchmark_unavailable" },
      candidates: [CANDIDATE],
      equityCurve: [{ date: "2026-07-01", equity: 100000 }, { date: current.clock.currentDate, equity: current.account.equity }],
      fills: orders.filter((order) => order.side === "buy").map((order) => ({ orderId: order.id, price: 17.32, slippageAmount: 2 })),
      lineage: current.lineage ?? null,
      orders: orders.map((order) => ({ ...order, candidateSnapshot: CANDIDATE })),
      performance: { annualizedReturn: 0, fees: 5, maxDrawdown: 0, sharpe: 0, slippage: 2, totalReturn: 0 },
      revealedAt: current.revealedAt ?? null,
    };
    else body = { error: { code: "not_mocked", issues: [], message: path } };
    await route.fulfill({ body: JSON.stringify(body), contentType: "application/json", status: 200 });
  });
}

test("fixed-market flow covers T+1 sell, finish, reveal, export and clone", async ({ page }, testInfo) => {
  test.skip(!["mobile-390", "desktop-1440"].includes(testInfo.project.name), "representative mobile and desktop flow");
  await installFixedMarket(page);
  await page.goto("/create");
  await page.getByRole("button", { name: "开始匿名练习" }).click();
  await page.getByRole("button", { name: "查看走势并交易" }).click();

  await page.getByLabel("交易理由").fill("首次突破买入");
  await page.getByRole("button", { name: "预览订单" }).click();
  await page.getByRole("button", { name: "确认提交" }).click();
  await page.getByRole("button", { name: "完成决策" }).last().click();
  await page.getByRole("button", { name: "推进到下一交易日" }).last().click();
  await expect(page.getByText(/可卖 0/)).toBeVisible();

  await page.getByRole("button", { name: "完成决策" }).last().click();
  await page.getByRole("button", { name: "推进到下一交易日" }).last().click();
  await expect(page.getByText(/可卖 100/)).toBeVisible();
  await page.getByLabel("方向").selectOption("sell");
  await page.getByLabel("交易理由").fill("T+1 后卖出复盘");
  await page.getByRole("button", { name: "预览订单" }).click();
  await page.getByRole("button", { name: "确认提交" }).click();

  await page.getByRole("link", { name: "复盘" }).click();
  await expect(page.getByText("T+1 后卖出复盘")).toBeVisible();
  await page.getByRole("button", { name: "结束并估值" }).click();
  await page.getByRole("button", { name: "揭晓身份" }).click();
  await page.getByRole("button", { name: "导出 JSON" }).click();
  await expect(page.getByText(/flow-parent\.json/)).toBeVisible();

  await page.getByRole("link", { name: "候选池" }).click();
  if (testInfo.project.name.startsWith("mobile")) await page.getByText("查看候选配置").click();
  const cloneRequest = page.waitForRequest((request) => request.url().endsWith("/clone"));
  await page.getByRole("button", { name: "克隆并调整配置" }).click();
  expect((await cloneRequest).postDataJSON()).toMatchObject({ selection: {} });
  await expect(page.getByRole("heading", { name: "候选A" })).toBeVisible();
});
