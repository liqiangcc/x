"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildDataPullRequestMergeArgs,
  buildDailyArgs,
  buildDispatchArgs,
  buildIssueBody,
  buildIssueComment,
  buildIssueSearchArgs,
  buildIssueTitle,
  buildReportWorkflowArgs,
  buildReportWorkflowCommand,
  dataBranchNameForRun,
  dataPullRequestBody,
  dataPullRequestTitle,
  isDataBranch,
  issueStatusForRun,
  selectDataPullRequest,
  sharedDataPullRequestFiles,
  shouldEnableDataPullRequestAutoMerge,
  shouldOpenDataPullRequest,
  shouldSyncJobIssue,
  shouldDispatchNextRun,
} = require("../scripts/github-daily-workflow");

test("buildDailyArgs uses safe workflow defaults", () => {
  assert.deepEqual(buildDailyArgs({}), [
    "daily",
    "--period",
    "daily",
    "--engine",
    "aws-router",
    "--universe",
    "market",
    "--job-mode",
    "batch",
    "--commit",
    "--allow-partial",
    "--concurrency",
    "4",
    "--retry-attempts",
    "3",
    "--retry-concurrency",
    "1",
    "--batch-size",
    "300",
    "--min-success-rate",
    "0.95",
    "--latest",
  ]);
});

test("buildDailyArgs forwards explicit workflow inputs", () => {
  assert.deepEqual(
    buildDailyArgs({
      DATE_INPUT: "20260630",
      PERIOD_INPUT: "yearly",
      LIMIT_INPUT: "25",
      ENGINE_INPUT: "local",
      FORCE_UNIVERSE_INPUT: "true",
      UNIVERSE_INPUT: "pool",
      FORCE_INPUT: "true",
    }),
    [
      "daily",
      "--period",
      "yearly",
      "--engine",
      "local",
      "--universe",
      "pool",
      "--job-mode",
      "batch",
      "--commit",
      "--allow-partial",
      "--concurrency",
      "4",
      "--retry-attempts",
      "0",
      "--retry-concurrency",
      "1",
      "--batch-size",
      "300",
      "--min-success-rate",
      "0.95",
      "--force",
      "--force-universe",
      "--limit",
      "25",
      "--date",
      "20260630",
    ]
  );
});

test("buildDailyArgs omits empty workflow limit", () => {
  assert.equal(buildDailyArgs({ LIMIT_INPUT: "" }).includes("--limit"), false);
});

test("buildDailyArgs forwards chained job inputs", () => {
  const args = buildDailyArgs({
    JOB_MODE_INPUT: "batch",
      JOB_ID_INPUT: "20260630-daily-market-hs-a",
      CHAIN_DEPTH_INPUT: "2",
      MAX_CHAIN_DEPTH_INPUT: "20",
      AWS_REGION_INPUT: "ap-northeast-1,ap-southeast-1",
      ROUTER_REGION_INPUT: "us-west-1,us-west-2",
      ROUTER_PROBE_INPUT: "false",
      ROUTER_PROBE_ATTEMPTS_INPUT: "2",
      ROUTER_PROBE_LMT_INPUT: "1",
      ROUTER_PROBE_SECID_INPUT: "1.600519",
      LAMBDA_NAME_INPUT: "kline-prod",
      CONFIG_INPUT: "config/kline.json",
    });

  assert.equal(args[args.indexOf("--job-id") + 1], "20260630-daily-market-hs-a");
  assert.equal(args[args.indexOf("--chain-depth") + 1], "2");
    assert.equal(args[args.indexOf("--max-chain-depth") + 1], "20");
    assert.equal(args[args.indexOf("--aws-region") + 1], "ap-northeast-1,ap-southeast-1");
    assert.equal(args[args.indexOf("--router-region") + 1], "us-west-1,us-west-2");
    assert.equal(args[args.indexOf("--router-probe") + 1], "false");
    assert.equal(args[args.indexOf("--router-probe-attempts") + 1], "2");
    assert.equal(args[args.indexOf("--router-probe-lmt") + 1], "1");
    assert.equal(args[args.indexOf("--router-probe-secid") + 1], "1.600519");
    assert.equal(args[args.indexOf("--lambda-name") + 1], "kline-prod");
  assert.equal(args[args.indexOf("--config") + 1], "config/kline.json");
});

test("buildDailyArgs uses the same stable daily and yearly AWS defaults", () => {
  const args = buildDailyArgs({ PERIOD_INPUT: "yearly", ENGINE_INPUT: "aws" });

  assert.equal(args[args.indexOf("--concurrency") + 1], "4");
  assert.equal(args[args.indexOf("--retry-attempts") + 1], "5");
  assert.equal(args[args.indexOf("--retry-concurrency") + 1], "1");
  assert.equal(args[args.indexOf("--batch-size") + 1], "300");
});

test("buildDailyArgs gives aws-router the same remote retry defaults", () => {
  const args = buildDailyArgs({ PERIOD_INPUT: "yearly" });

  assert.equal(args[args.indexOf("--engine") + 1], "aws-router");
  assert.equal(args[args.indexOf("--retry-attempts") + 1], "5");
  assert.equal(args[args.indexOf("--retry-concurrency") + 1], "1");
});

test("buildDailyArgs forwards Huawei Cloud engine and region", () => {
  const args = buildDailyArgs({
    ENGINE_INPUT: "huaweicloud",
    HUAWEICLOUD_REGION_INPUT: "cn-east-3,cn-north-4",
    PERIOD_INPUT: "yearly",
  });

  assert.equal(args[args.indexOf("--engine") + 1], "huaweicloud");
  assert.equal(args[args.indexOf("--huaweicloud-region") + 1], "cn-east-3,cn-north-4");
  assert.equal(args[args.indexOf("--retry-attempts") + 1], "5");
});

test("buildDailyArgs lets manual batch and concurrency inputs override defaults", () => {
  const args = buildDailyArgs({
    BATCH_SIZE_INPUT: "50",
    CONCURRENCY_INPUT: "2",
  });

  assert.equal(args[args.indexOf("--concurrency") + 1], "2");
  assert.equal(args[args.indexOf("--batch-size") + 1], "50");
});

test("shouldDispatchNextRun only dispatches active GitHub batch jobs", () => {
  const run = {
    should_dispatch_next: true,
    job_mode: "batch",
    job_status: "running",
    chain_depth: 2,
    max_chain_depth: 10,
  };

  assert.equal(shouldDispatchNextRun(run, { GITHUB_ACTIONS: "true" }), true);
  assert.equal(shouldDispatchNextRun(run, { GITHUB_ACTIONS: "false" }), false);
  assert.equal(shouldDispatchNextRun({ ...run, job_status: "completed" }, { GITHUB_ACTIONS: "true" }), false);
  assert.equal(shouldDispatchNextRun({ ...run, chain_depth: 10 }, { GITHUB_ACTIONS: "true" }), false);
  assert.equal(
    shouldDispatchNextRun(run, { GITHUB_ACTIONS: "true", DISABLE_CHAIN_DISPATCH: "true" }),
    false
  );
});

test("buildDispatchArgs resumes the next batch with stable inputs", () => {
  const args = buildDispatchArgs(
    {
      aws_region: "ap-northeast-1,ap-southeast-1",
      batch_size: 500,
      chain_depth: 2,
      concurrency: "1",
      config: "config/kline.json",
      date: "20260630",
      engine: "aws-router",
      force: false,
      huaweicloud_region: "cn-east-3",
      job_id: "20260630-daily-market-hs-a",
      lambda_name: "kline",
      max_chain_depth: 20,
      min_success_rate: "0.95",
      period: "daily",
      retry_attempts: "3",
      retry_concurrency: "1",
      router_probe_attempts: "1",
      router_probe_lmt: "1",
      router_probe_requested: "true",
      router_probe_secid: "1.600519",
      router_region_requested: "auto",
      router_region_resolved: "us-west-1,us-west-2",
      universe: "market",
    },
    {
      GITHUB_REF_NAME: "master",
      GITHUB_WORKFLOW: "Daily Data Commit",
    }
  );

  assert.deepEqual(args.slice(0, 5), [
    "workflow",
    "run",
    "Daily Data Commit",
    "--ref",
    "data/daily/20260630-market-20260630-daily-market-hs-a",
  ]);
  assert.equal(args[args.indexOf("-f") + 1], "date=20260630");
  assert.equal(args.includes("chain_depth=3"), true);
  assert.equal(args.includes("job_id=20260630-daily-market-hs-a"), true);
  assert.equal(args.includes("aws_region=ap-northeast-1,ap-southeast-1"), true);
  assert.equal(args.includes("router_region=auto"), true);
  assert.equal(args.includes("router_probe=true"), true);
  assert.equal(args.includes("router_probe_attempts=1"), true);
  assert.equal(args.includes("router_probe_lmt=1"), true);
  assert.equal(args.includes("router_probe_secid=1.600519"), true);
  assert.equal(args.includes("huaweicloud_region=cn-east-3"), true);
});

test("buildReportWorkflowArgs points manual report generation at the data branch", () => {
  const run = {
    date: "20260701",
    job_id: "20260701-daily-market-hs-a",
    period: "daily",
    universe: "market",
  };

  assert.deepEqual(
    buildReportWorkflowArgs(run, { GITHUB_REF_NAME: "master" }),
    [
      "workflow",
      "run",
      "daily-report.yml",
      "--ref",
      "master",
      "-f",
      "date=20260701",
      "-f",
      "data_ref=data/daily/20260701-market-20260701-daily-market-hs-a",
    ]
  );
  assert.match(
    buildReportWorkflowCommand(run, { GITHUB_REF_NAME: "master" }),
    /gh workflow run daily-report\.yml/
  );
  assert.equal(buildReportWorkflowArgs({ ...run, period: "yearly" }, { GITHUB_REF_NAME: "master" }), null);
});

test("dataBranchNameForRun separates daily and yearly data branches", () => {
  assert.equal(isDataBranch("data/daily/20260701-market-job"), true);
  assert.equal(isDataBranch("master"), false);
  assert.equal(
    dataBranchNameForRun({
      date: "20260701",
      job_id: "20260701-daily-market-hs-a",
      period: "daily",
      universe: "market",
    }, { GITHUB_REF_NAME: "master" }),
    "data/daily/20260701-market-20260701-daily-market-hs-a"
  );
  assert.equal(
    dataBranchNameForRun({
      date: "20260701",
      job_id: "20260701-yearly-market-hs-a",
      period: "yearly",
      universe: "market",
    }, { GITHUB_REF_NAME: "master" }),
    "data/yearly/20260701-market-20260701-yearly-market-hs-a"
  );
  assert.equal(
    dataBranchNameForRun({ date: "20260701", period: "daily", universe: "market" }, {
      GITHUB_REF_NAME: "data/daily/custom",
    }),
    "data/daily/custom"
  );
});

function sampleRun(overrides = {}) {
  return {
    artifacts: {
      kline_summary: "data/kline/daily/summary.daily.json",
    },
    batch_size: 500,
    chain_depth: 2,
    engine: "aws",
    job_id: "20260630-daily-market-hs-a",
    job_mode: "batch",
    job_status: "running",
    kline_failure_reason_counts: {},
    kline_failure_reasons: [],
    kline_region_counts: { "ap-northeast-1": 3 },
    max_chain_depth: 20,
    period: "daily",
    progress_batch_codes: 500,
    progress_batch_source: "pending",
    progress_counts: {
      blocked: 0,
      completed: 1000,
      failed: 2,
      pending: 4532,
      remaining: 4534,
    },
    progress_file: "data/jobs/20260630/daily/20260630-daily-market-hs-a/progress.json",
    router_region_requested: "auto",
    router_region_resolved: "us-west-1,us-west-2",
    router_probe_requested: "true",
    router_probe_attempts: "1",
    router_probe_lmt: "1",
    router_probe_secid: "1.600519",
    router_probe_summary: {
      status: "selected",
    },
    should_dispatch_next: true,
    universe: "market",
    date: "20260630",
    ...overrides,
  };
}

test("buildIssueTitle is unique per daily job id", () => {
  assert.equal(
    buildIssueTitle(sampleRun()),
    "Kline sync 20260630 daily market 20260630-daily-market-hs-a"
  );
});

test("issueStatusForRun maps terminal and dispatch failure states", () => {
  assert.equal(issueStatusForRun(sampleRun()), "running");
  assert.equal(issueStatusForRun(sampleRun({ job_status: "completed" })), "completed");
  assert.equal(issueStatusForRun(sampleRun({ job_status: "blocked" })), "blocked");
  assert.equal(issueStatusForRun(sampleRun({ should_dispatch_next: false }), { dailyCode: 1 }), "failed");
  assert.equal(issueStatusForRun(sampleRun(), { dispatchError: new Error("dispatch failed") }), "failed");
  assert.equal(
    issueStatusForRun(sampleRun({ job_status: "completed" }), {
      dataPullRequestError: new Error("pr failed"),
    }),
    "failed"
  );
});

test("shouldSyncJobIssue only enables issue writes for GitHub batch jobs", () => {
  assert.equal(shouldSyncJobIssue(sampleRun(), { GITHUB_ACTIONS: "true" }), true);
  assert.equal(shouldSyncJobIssue(sampleRun(), { GITHUB_ACTIONS: "false" }), false);
  assert.equal(shouldSyncJobIssue(sampleRun(), { GITHUB_ACTIONS: "true", DISABLE_JOB_ISSUES: "true" }), false);
  assert.equal(shouldSyncJobIssue(sampleRun({ job_mode: "single" }), { GITHUB_ACTIONS: "true" }), false);
});

test("buildIssueBody includes progress, run link, and resume command", () => {
  const body = buildIssueBody(sampleRun(), {
    dispatchNext: true,
    env: {
      GITHUB_REF_NAME: "master",
      GITHUB_REPOSITORY: "liqiangcc/x",
      GITHUB_RUN_ID: "123",
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_WORKFLOW: "Daily Data Commit",
    },
  });

  assert.match(body, /- job_id: 20260630-daily-market-hs-a/);
  assert.match(body, /- completed: 1000/);
  assert.match(body, /- pending: 4532/);
  assert.match(body, /- failed: 2/);
  assert.match(body, /- completion_rate: 18\.07%/);
  assert.match(body, /- router_region: us-west-1,us-west-2/);
  assert.match(body, /- router_probe: selected/);
  assert.match(body, /https:\/\/github\.com\/liqiangcc\/x\/actions\/runs\/123/);
  assert.match(body, /gh workflow run 'Daily Data Commit'/);
  assert.match(body, /chain_depth=3/);
  assert.match(body, /--ref data\/daily\/20260630-market-20260630-daily-market-hs-a/);
});

test("buildIssueBody records data pull request state", () => {
  const body = buildIssueBody(sampleRun({ job_status: "completed", should_dispatch_next: false }), {
    dataPullRequest: {
      state: "OPEN",
      url: "https://github.com/liqiangcc/x/pull/123",
    },
    dataPullRequestAutoMerge: {
      enabled: true,
      reason: "enabled",
    },
  });

  assert.match(body, /- status: completed/);
  assert.match(body, /- data_pr: https:\/\/github.com\/liqiangcc\/x\/pull\/123/);
  assert.match(body, /- data_pr_state: OPEN/);
  assert.match(body, /- data_pr_auto_merge: enabled/);
  assert.match(body, /- data_pr_error: n\/a/);
  assert.match(body, /## Daily report/);
  assert.match(body, /daily-report\.yml/);
});

test("buildIssueBody keeps issues open when data pull request setup fails", () => {
  const body = buildIssueBody(sampleRun({ job_status: "completed", should_dispatch_next: false }), {
    dataPullRequestError: new Error("createPullRequest denied"),
  });

  assert.match(body, /- status: failed/);
  assert.match(body, /- data_pr_error: createPullRequest denied/);
});

test("buildIssueComment only comments on important states", () => {
  const run = sampleRun();

  assert.equal(buildIssueComment(run, "running"), null);
  assert.equal(buildIssueComment(run, "running", { issueCreated: true }), "Started kline sync job `20260630-daily-market-hs-a`.");
  assert.match(buildIssueComment(run, "blocked"), /is blocked/);
  assert.match(buildIssueComment(run, "completed"), /completed/);
  assert.match(
    buildIssueComment(run, "completed", {
      dataPullRequest: { url: "https://github.com/liqiangcc/x/pull/123" },
    }),
    /Data PR: https:\/\/github.com\/liqiangcc\/x\/pull\/123/
  );
  assert.match(buildIssueComment(run, "completed", { issueCreated: true }), /completed/);
  assert.match(
    buildIssueComment(run, "failed", { dispatchError: new Error("dispatch failed") }),
    /dispatch failed/
  );
  assert.match(
    buildIssueComment(run, "failed", { dataPullRequestError: new Error("pr failed") }),
    /pr failed/
  );
});

test("buildIssueSearchArgs searches all issues by exact title candidate", () => {
  assert.deepEqual(buildIssueSearchArgs("Kline sync 20260630 daily market job"), [
    "issue",
    "list",
    "--state",
    "all",
    "--limit",
    "20",
    "--search",
    "in:title \"Kline sync 20260630 daily market job\"",
    "--json",
    "number,title,state,url",
  ]);
});

test("data pull request helpers only open completed data branch jobs", () => {
  const run = sampleRun({ job_status: "completed", should_dispatch_next: false });
  const branch = "data/daily/20260630-market-20260630-daily-market-hs-a";

  assert.equal(shouldOpenDataPullRequest(run, branch, { GITHUB_ACTIONS: "true" }), true);
  assert.equal(shouldOpenDataPullRequest(sampleRun(), branch, { GITHUB_ACTIONS: "true" }), false);
  assert.equal(shouldOpenDataPullRequest(run, "master", { GITHUB_ACTIONS: "true" }), false);
  assert.equal(dataPullRequestTitle(run), "data(daily): 20260630 market kline sync");
  assert.match(dataPullRequestBody(run, branch), /- branch: data\/daily/);
});

test("data pull request helpers select reusable prs and auto-merge open prs", () => {
  assert.deepEqual(
    selectDataPullRequest([
      { number: 1, state: "CLOSED", url: "https://github.com/liqiangcc/x/pull/1" },
      { number: 2, state: "OPEN", url: "https://github.com/liqiangcc/x/pull/2" },
      { number: 3, state: "MERGED", url: "https://github.com/liqiangcc/x/pull/3" },
    ]),
    { number: 2, state: "OPEN", url: "https://github.com/liqiangcc/x/pull/2" }
  );
  assert.deepEqual(
    buildDataPullRequestMergeArgs({ url: "https://github.com/liqiangcc/x/pull/2" }),
    ["pr", "merge", "https://github.com/liqiangcc/x/pull/2", "--auto", "--squash"]
  );
  assert.equal(
    shouldEnableDataPullRequestAutoMerge(
      { state: "OPEN", url: "https://github.com/liqiangcc/x/pull/2" },
      {}
    ),
    true
  );
  assert.equal(
    shouldEnableDataPullRequestAutoMerge(
      { state: "OPEN", url: "https://github.com/liqiangcc/x/pull/2" },
      { DISABLE_DATA_PR_AUTO_MERGE: "true" }
    ),
    false
  );
  assert.equal(
    shouldEnableDataPullRequestAutoMerge(
      { state: "MERGED", url: "https://github.com/liqiangcc/x/pull/2" },
      {}
    ),
    false
  );
});

test("sharedDataPullRequestFiles rejects shared data roots", () => {
  assert.deepEqual(
    sharedDataPullRequestFiles([
      "data/kline/daily/000/000001.json",
      "data/jobs/20260701/daily/job/progress.json",
      "runs/20260701T000000Z_daily/run.json",
      "data/universe/20260701/codes.json",
      "data/pool/20260701/zt.json",
    ]),
    [
      "data/universe/20260701/codes.json",
      "data/pool/20260701/zt.json",
    ]
  );
});
