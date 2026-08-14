"use strict";

const path = require("node:path");
const {
  LedgerSecurityMasterReader,
} = require("../src/adapters/ledger/ledger_security_master_reader");
const {
  ValidateSecurityMasterUseCase,
} = require("../src/application/market/validate_security_master");
const {
  createSecurityExecutionProfileResolver,
} = require("../src/simulation/execution/security_execution_profile_resolver");

const ROOT = path.resolve(__dirname, "..");

function formatIssue(issue) {
  const security = issue.securityKey ? ` ${issue.securityKey}` : "";
  const entries = issue.entryIndexes?.length
    ? ` entries=${issue.entryIndexes.join(",")}`
    : "";
  return `${issue.severity.toUpperCase()} ${issue.code}${security}${entries}: ${issue.message}`;
}

async function main() {
  const useCase = new ValidateSecurityMasterUseCase({
    securityMasterSnapshotReader: new LedgerSecurityMasterReader({
      dataRoot: path.join(ROOT, "data"),
    }),
    securityExecutionProfileResolver: createSecurityExecutionProfileResolver(),
  });
  const report = await useCase.execute();
  const summary = report.summary;

  for (const issue of report.issues) {
    const line = formatIssue(issue);
    if (issue.severity === "error") console.error(line);
    else console.warn(line);
  }

  const status = report.ok ? "ok" : "invalid";
  console.log(
    `security-master: ${status} (${summary.validRecordCount}/${summary.recordCount} valid records, `
      + `${summary.securityCount} securities, ${summary.errorCount} errors, ${summary.warningCount} warnings, `
      + `${summary.profileResolutionCount} profile checks)`
  );

  if (!report.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`security-master: failed (${error.message})`);
  process.exit(1);
});
