"use strict";

function isoNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function uniqueCodes(codes) {
  return [...new Set((codes ?? []).map((code) => String(code).trim()).filter(Boolean))].sort();
}

function parsePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function parseNonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function calculateMaxChainDepth(totalCodes, batchSize, retryBudget = 8) {
  const safeBatchSize = parsePositiveInteger(batchSize, 1);
  const safeTotal = parseNonNegativeInteger(totalCodes, 0);
  const safeRetryBudget = parseNonNegativeInteger(retryBudget, 0);
  return Math.ceil(safeTotal / safeBatchSize) + safeRetryBudget;
}

function normalizeJobId(value, fallback) {
  const normalized = String(value ?? fallback ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) {
    throw new Error("Job id is empty.");
  }
  return normalized;
}

function countCodes(progress) {
  return {
    pending: progress.pending_codes.length,
    completed: progress.completed_codes.length,
    failed: progress.failed_codes.length,
    blocked: progress.blocked_codes.length,
    remaining: progress.pending_codes.length + progress.failed_codes.length + progress.blocked_codes.length,
  };
}

function validateProgress(progress) {
  const allCodes = uniqueCodes(progress.all_codes);
  const sets = [
    ["pending_codes", uniqueCodes(progress.pending_codes)],
    ["completed_codes", uniqueCodes(progress.completed_codes)],
    ["failed_codes", uniqueCodes(progress.failed_codes)],
    ["blocked_codes", uniqueCodes(progress.blocked_codes)],
  ];
  const seen = new Map();

  for (const [field, codes] of sets) {
    for (const code of codes) {
      if (!allCodes.includes(code)) {
        throw new Error(`Progress ${field} contains unknown code: ${code}`);
      }
      if (seen.has(code)) {
        throw new Error(`Progress code ${code} appears in both ${seen.get(code)} and ${field}`);
      }
      seen.set(code, field);
    }
  }

  if (seen.size !== allCodes.length) {
    const missing = allCodes.filter((code) => !seen.has(code));
    throw new Error(`Progress is missing ${missing.length} code(s): ${missing.slice(0, 5).join(", ")}`);
  }

  if (Number(progress.total_codes) !== allCodes.length) {
    throw new Error(`Progress total_codes ${progress.total_codes} does not match all_codes ${allCodes.length}`);
  }
}

function initializeProgress({
  batchSize,
  chainDepth = 0,
  codes,
  date,
  jobId,
  market = null,
  maxChainDepth = null,
  period,
  universe,
}) {
  const allCodes = uniqueCodes(codes);
  const safeBatchSize = parsePositiveInteger(batchSize, allCodes.length || 1);
  const depth = parseNonNegativeInteger(chainDepth, 0);
  const safeMaxChainDepth = parsePositiveInteger(
    maxChainDepth,
    calculateMaxChainDepth(allCodes.length, safeBatchSize)
  );
  const now = isoNow();
  const progress = {
    version: 1,
    job_id: normalizeJobId(jobId),
    date,
    period,
    universe,
    market,
    status: allCodes.length === 0 ? "completed" : "running",
    total_codes: allCodes.length,
    batch_size: safeBatchSize,
    chain_depth: depth,
    max_chain_depth: safeMaxChainDepth,
    all_codes: allCodes,
    pending_codes: allCodes,
    completed_codes: [],
    failed_codes: [],
    blocked_codes: [],
    last_batch_codes: [],
    last_batch_source: null,
    last_summary: null,
    created_at: now,
    updated_at: now,
    counts: {
      pending: allCodes.length,
      completed: 0,
      failed: 0,
      blocked: 0,
      remaining: allCodes.length,
    },
  };
  validateProgress(progress);
  return progress;
}

function normalizeProgress(progress) {
  const normalized = {
    ...progress,
    all_codes: uniqueCodes(progress.all_codes),
    pending_codes: uniqueCodes(progress.pending_codes),
    completed_codes: uniqueCodes(progress.completed_codes),
    failed_codes: uniqueCodes(progress.failed_codes),
    blocked_codes: uniqueCodes(progress.blocked_codes),
    batch_size: parsePositiveInteger(progress.batch_size, 1),
    chain_depth: parseNonNegativeInteger(progress.chain_depth, 0),
    max_chain_depth: parsePositiveInteger(progress.max_chain_depth, 1),
    total_codes: parseNonNegativeInteger(progress.total_codes, 0),
  };
  normalized.counts = countCodes(normalized);
  validateProgress(normalized);
  return normalized;
}

function finalizeStatus(progress) {
  const counts = countCodes(progress);
  progress.counts = counts;
  if (counts.remaining === 0) {
    progress.status = "completed";
  } else if (progress.chain_depth >= progress.max_chain_depth) {
    progress.status = "blocked";
  } else {
    progress.status = "running";
  }
}

function selectProgressBatch(progress) {
  const normalized = normalizeProgress(progress);
  const limit = normalized.batch_size;
  const pending = normalized.pending_codes.slice(0, limit);
  const remaining = limit - pending.length;
  const failed = remaining > 0 ? normalized.failed_codes.slice(0, remaining) : [];
  const codes = [...pending, ...failed];
  let source = "none";
  if (pending.length > 0 && failed.length > 0) {
    source = "pending_then_failed";
  } else if (pending.length > 0) {
    source = "pending";
  } else if (failed.length > 0) {
    source = "failed";
  }

  return {
    codes,
    source,
    pending_count: pending.length,
    failed_count: failed.length,
  };
}

function isCompletedKlineStatus(status) {
  return ["success", "migrated_existing", "skipped_existing"].includes(status);
}

function applyProgressResults(progress, summary, { chainDepth = null } = {}) {
  const updated = normalizeProgress(progress);
  const files = summary?.files && typeof summary.files === "object" ? summary.files : {};
  const completed = new Set(updated.completed_codes);
  const pending = new Set(updated.pending_codes);
  const failed = new Set(updated.failed_codes);
  const blocked = new Set(updated.blocked_codes);
  const all = new Set(updated.all_codes);
  const batchCodes = uniqueCodes(updated.last_batch_codes);
  const attemptedCodes = new Set([...batchCodes, ...Object.keys(files).map(String)]);
  let completedInBatch = 0;

  for (const code of attemptedCodes) {
    if (!all.has(code)) {
      continue;
    }
    pending.delete(code);
    blocked.delete(code);

    const status = files[code]?.status;
    if (isCompletedKlineStatus(status)) {
      completed.add(code);
      failed.delete(code);
      completedInBatch += 1;
    } else if (status === "failed") {
      completed.delete(code);
      failed.add(code);
    } else if (!completed.has(code)) {
      failed.add(code);
    }
  }

  updated.pending_codes = [...pending].sort();
  updated.completed_codes = [...completed].sort();
  updated.failed_codes = [...failed].sort();
  updated.blocked_codes = [...blocked].sort();
  if (chainDepth !== null) {
    updated.chain_depth = parseNonNegativeInteger(chainDepth, updated.chain_depth);
  }
  updated.last_summary = {
    status: summary?.status ?? null,
    total_codes: Number(summary?.total_codes ?? 0),
    success: Number(summary?.success ?? 0),
    migrated_existing: Number(summary?.migrated_existing ?? 0),
    skipped_existing: Number(summary?.skipped_existing ?? 0),
    failed: Number(summary?.failed ?? 0),
    success_rate: summary?.success_rate ?? null,
    failure_reasons: Array.isArray(summary?.failure_reasons) ? summary.failure_reasons : [],
    engine_counts: summary?.engine_counts ?? {},
    region_counts: summary?.region_counts ?? {},
  };
  updated.updated_at = isoNow();
  finalizeStatus(updated);
  if (
    updated.status === "running" &&
    updated.pending_codes.length === 0 &&
    updated.failed_codes.length > 0 &&
    updated.last_batch_source === "failed" &&
    completedInBatch === 0
  ) {
    updated.status = "completed";
  }
  validateProgress(updated);
  return updated;
}

function markProgressCodesFailed(progress, codes) {
  const updated = normalizeProgress(progress);
  const invalidCodes = new Set(uniqueCodes(codes));
  if (invalidCodes.size === 0) {
    return updated;
  }

  const completed = new Set(updated.completed_codes);
  const failed = new Set(updated.failed_codes);
  const blocked = new Set(updated.blocked_codes);
  const all = new Set(updated.all_codes);

  for (const code of invalidCodes) {
    if (!all.has(code)) {
      continue;
    }
    if (completed.delete(code) || blocked.delete(code) || failed.has(code)) {
      failed.add(code);
      blocked.delete(code);
    }
  }

  updated.completed_codes = [...completed].sort();
  updated.failed_codes = [...failed].sort();
  updated.blocked_codes = [...blocked].sort();
  updated.counts = countCodes(updated);
  updated.updated_at = isoNow();
  finalizeStatus(updated);
  validateProgress(updated);
  return updated;
}

module.exports = {
  applyProgressResults,
  calculateMaxChainDepth,
  initializeProgress,
  markProgressCodesFailed,
  normalizeJobId,
  normalizeProgress,
  selectProgressBatch,
  uniqueCodes,
  validateProgress,
};
