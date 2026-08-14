"use strict";

const path = require("node:path");
const {
  DEFAULT_EXECUTION_PROFILE_MANIFEST_PATH,
  readExecutionProfileManifestSnapshot,
} = require("../src/adapters/ledger/ledger_execution_profile_timeline_reader");

const ROOT = path.resolve(__dirname, "..");

function validateExecutionProfileRepository({
  dataRoot = path.join(ROOT, "data"),
  manifestPath = DEFAULT_EXECUTION_PROFILE_MANIFEST_PATH,
} = {}) {
  let snapshot;
  try {
    snapshot = readExecutionProfileManifestSnapshot({ dataRoot, manifestPath });
  } catch (error) {
    return Object.freeze({
      ok: false,
      status: "invalid",
      message: error.message,
      summary: Object.freeze({ revisionCount: 0, profileCount: 0 }),
    });
  }

  if (!snapshot.available) {
    return Object.freeze({
      ok: true,
      status: "unconfigured",
      message: "execution profile manifest is absent; temporal rule data remains disabled",
      summary: Object.freeze({ revisionCount: 0, profileCount: 0 }),
    });
  }

  if (snapshot.revisions.length === 0) {
    return Object.freeze({
      ok: false,
      status: "empty",
      message: "execution profile manifest contains no auditable revisions",
      summary: Object.freeze({ revisionCount: 0, profileCount: 0 }),
    });
  }

  const profileCount = new Set(
    snapshot.revisions.map((revision) => revision.profileId)
  ).size;
  return Object.freeze({
    ok: true,
    status: "ok",
    message: "execution profile revisions are structurally valid",
    summary: Object.freeze({
      revisionCount: snapshot.revisions.length,
      profileCount,
    }),
  });
}

function main() {
  const report = validateExecutionProfileRepository();
  const { revisionCount, profileCount } = report.summary;
  const line = `execution-profiles: ${report.status} (${revisionCount} revisions, ${profileCount} profiles) - ${report.message}`;
  if (report.ok) console.log(line);
  else console.error(line);
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = {
  main,
  validateExecutionProfileRepository,
};
