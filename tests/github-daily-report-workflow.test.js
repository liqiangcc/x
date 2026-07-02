"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildIssueSearchArgs,
  buildReportIssueBody,
  buildReportIssueTitle,
  normalizeOptions,
  renderCandidateTable,
  reportBranchName,
  reportPullRequestBody,
  reportPullRequestTitle,
  selectReportIssue,
  selectReportPullRequest,
  topCandidateRows,
} = require("../scripts/github-daily-report-workflow");

function sampleReport(overrides = {}) {
  return {
    candidates: [
      {
        code: "600001",
        data_quality: "ok",
        name: "Alpha|One",
        pools: ["zt", "qs"],
        rank: 1,
        score: 120,
        signals: [{ id: "limit_up_pool" }, { id: "year_breakout" }],
      },
      {
        code: "600002",
        data_quality: "recorded",
        name: "Beta",
        pools: ["zb"],
        rank: 2,
        score: 15,
        signals: [{ id: "limit_break_pool" }],
      },
    ],
    date: "20260701",
    quality: {
      issue_counts: { missing_yearly_kline: 1 },
      status: "recorded",
    },
    summary: {
      candidate_count: 2,
      issue_counts: { missing_yearly_kline: 1 },
      status: "recorded",
    },
    ...overrides,
  };
}

test("normalizeOptions validates report date and defaults workflow options", () => {
  assert.deepEqual(
    normalizeOptions({
      DATE_INPUT: "20260701",
      GITHUB_REF_NAME: "master",
    }),
    {
      baseRef: "master",
      commitReport: true,
      dataRef: "master",
      date: "20260701",
      openIssue: true,
    }
  );

  const options = normalizeOptions({
    COMMIT_REPORT_INPUT: "false",
    DATA_REF_INPUT: "data/daily/job",
    DATE_INPUT: "2026-07-01",
    OPEN_ISSUE_INPUT: "0",
  });
  assert.equal(options.commitReport, false);
  assert.equal(options.openIssue, false);
  assert.equal(options.dataRef, "data/daily/job");
});

test("report workflow helper names are stable", () => {
  assert.equal(reportBranchName("20260701"), "report/daily/20260701");
  assert.equal(reportPullRequestTitle("20260701"), "report(daily): 20260701 candidate report");
  assert.equal(buildReportIssueTitle("20260701"), "Daily report 20260701");
  assert.deepEqual(buildIssueSearchArgs("Daily report 20260701"), [
    "issue",
    "list",
    "--state",
    "all",
    "--limit",
    "20",
    "--search",
    "in:title \"Daily report 20260701\"",
    "--json",
    "number,title,state,url",
  ]);
});

test("report issue and PR selectors prefer active records", () => {
  assert.deepEqual(
    selectReportIssue([
      { number: 1, state: "CLOSED", title: "Daily report 20260701" },
      { number: 2, state: "OPEN", title: "Daily report 20260701" },
    ], "Daily report 20260701"),
    { number: 2, state: "OPEN", title: "Daily report 20260701" }
  );
  assert.deepEqual(
    selectReportIssue([
      { number: 1, state: "CLOSED", title: "Daily report 20260701" },
    ], "Daily report 20260701"),
    { number: 1, state: "CLOSED", title: "Daily report 20260701" }
  );
  assert.deepEqual(
    selectReportPullRequest([
      { number: 1, state: "CLOSED" },
      { number: 2, state: "OPEN" },
    ]),
    { number: 2, state: "OPEN" }
  );
});

test("report issue body renders artifacts, top candidates, and PR state", () => {
  const body = buildReportIssueBody({
    dataRef: "data/daily/20260701-market-job",
    env: {
      GITHUB_REPOSITORY: "liqiangcc/x",
      GITHUB_RUN_ID: "123",
      GITHUB_SERVER_URL: "https://github.com",
    },
    report: sampleReport(),
    reportPullRequest: {
      state: "OPEN",
      url: "https://github.com/liqiangcc/x/pull/99",
    },
  });

  assert.match(body, /- date: 20260701/);
  assert.match(body, /- report_pr: https:\/\/github.com\/liqiangcc\/x\/pull\/99/);
  assert.match(body, /reports\/20260701\/summary.md/);
  assert.match(body, /https:\/\/github.com\/liqiangcc\/x\/actions\/runs\/123/);
  assert.match(body, /Alpha\\\|One/);
  assert.match(body, /year_breakout/);
});

test("report PR body and candidate table are deterministic", () => {
  const report = sampleReport();
  assert.deepEqual(topCandidateRows(report.candidates), [
    {
      code: "600001",
      name: "Alpha|One",
      pools: "zt|qs",
      quality: "ok",
      rank: 1,
      score: 120,
      signals: "limit_up_pool|year_breakout",
    },
    {
      code: "600002",
      name: "Beta",
      pools: "zb",
      quality: "recorded",
      rank: 2,
      score: 15,
      signals: "limit_break_pool",
    },
  ]);
  assert.match(renderCandidateTable(report.candidates), /Alpha\\\|One/);
  assert.match(
    reportPullRequestBody({
      branchName: "report/daily/20260701",
      dataRef: "master",
      report,
    }),
    /reports\/20260701\/candidates.csv/
  );
});
