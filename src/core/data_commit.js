"use strict";

function formatBatchNumber(run) {
  if (run?.job_mode !== "batch") {
    return null;
  }
  const chainDepth = Number(run.chain_depth);
  if (!Number.isInteger(chainDepth) || chainDepth < 0) {
    return null;
  }
  return String(chainDepth + 1).padStart(3, "0");
}

function dataCommitMessage(run, quality) {
  const qualityStatus = quality?.status ?? "recorded";
  const period = run.period ?? "daily";
  const universe = run.universe ?? "pool";
  const batchNumber = formatBatchNumber(run);
  const batchText = batchNumber ? ` batch ${batchNumber}` : "";
  const title = `data(${period}): ${run.date}${batchText} update ${universe} kline`;
  const body = [
    `run_id: ${run.run_id}`,
    `pool_date: ${run.date}`,
    `universe: ${universe}`,
    `market: ${run.market ?? "n/a"}`,
    `universe_total_codes: ${run.universe_total_codes ?? "n/a"}`,
    `period: ${period}`,
    `engine: ${run.engine}`,
    `total: ${run.total}`,
    `success: ${run.success}`,
    `failed: ${run.failed}`,
    `skipped: ${run.skipped}`,
    `batch_size: ${run.batch_size ?? "n/a"}`,
    `selection_mode: ${run.selection_mode ?? "n/a"}`,
    `job_mode: ${run.job_mode ?? "single"}`,
    `job_id: ${run.job_id ?? "n/a"}`,
    `job_status: ${run.job_status ?? "n/a"}`,
    `chain_depth: ${run.chain_depth ?? "n/a"}`,
    `max_chain_depth: ${run.max_chain_depth ?? "n/a"}`,
    `progress_counts: ${JSON.stringify(run.progress_counts ?? {})}`,
    `should_dispatch_next: ${run.should_dispatch_next ?? false}`,
    `initial_failed: ${run.initial_failed ?? 0}`,
    `retried: ${run.retried ?? 0}`,
    `retry_success: ${run.retry_success ?? 0}`,
    `retry_failed: ${run.retry_failed ?? 0}`,
    `success_rate: ${run.kline_success_rate ?? "n/a"}`,
    `engine_counts: ${JSON.stringify(run.kline_engine_counts ?? {})}`,
    `region_counts: ${JSON.stringify(run.kline_region_counts ?? {})}`,
    `failure_reason_counts: ${JSON.stringify(run.kline_failure_reason_counts ?? {})}`,
    `expected_latest_date: ${run.expected_latest_date ?? "n/a"}`,
    `freshness_codes: ${run.freshness_codes ?? "n/a"}`,
    `freshness_source: ${run.freshness_source ?? "n/a"}`,
    `stale_completed: ${run.stale_completed ?? 0}`,
    `quality: ${qualityStatus}`,
  ].join("\n");
  return { title, body };
}

module.exports = {
  dataCommitMessage,
  formatBatchNumber,
};
