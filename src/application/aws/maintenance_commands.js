"use strict";

const {
  AWS_ACCESS_KEY_SECRET,
  AWS_REGION_VARIABLE,
  AWS_SECRET_KEY_SECRET,
  normalizeAwsOptions,
  sanitizeError,
  summarizeCredentials,
} = require("../../aws/maintenance");
const {
  assertAwsMaintenanceReader,
  assertGitHubSettingsWriter,
} = require("../../ports/aws/maintenance_runtime");

function requireTool(tool, command) {
  if (!tool?.ok) {
    throw new Error(`${command} CLI is not available: ${tool?.error}`);
  }
  return tool;
}

class CheckAwsMaintenanceStatusUseCase {
  constructor({ maintenanceReader } = {}) {
    this.maintenanceReader = assertAwsMaintenanceReader(maintenanceReader);
  }

  async execute(rawOptions = {}) {
    const options = normalizeAwsOptions(rawOptions);
    const summary = {
      profile: options.profile,
      region: options.region,
      preflight_region: options.preflightRegion ?? "config/default",
      lambda_name: options.lambdaName,
      tools: {
        aws: await this.maintenanceReader.getToolVersion("aws", ["--version"]),
        gh: await this.maintenanceReader.getToolVersion("gh", ["--version"]),
      },
      credentials: null,
      identity: null,
      lambda_preflight: null,
      status: "ok",
    };

    let credentialsOk = false;
    if (summary.tools.aws.ok) {
      try {
        const credentials = await this.maintenanceReader.readCredentials(options.profile);
        summary.credentials = {
          ok: true,
          ...summarizeCredentials(credentials),
        };
        credentialsOk = true;
      } catch (error) {
        summary.credentials = {
          ok: false,
          error: sanitizeError(error),
        };
      }

      try {
        summary.identity = {
          ok: true,
          ...(await this.maintenanceReader.getIdentity(options.profile)),
        };
      } catch (error) {
        summary.identity = {
          ok: false,
          error: sanitizeError(error),
        };
      }
    } else {
      summary.credentials = {
        ok: false,
        error: "aws CLI is unavailable.",
      };
      summary.identity = {
        ok: false,
        error: "aws CLI is unavailable.",
      };
    }

    if (credentialsOk) {
      summary.lambda_preflight = await this.maintenanceReader.runKlinePreflight(options);
    } else {
      summary.lambda_preflight = {
        ok: false,
        error: "Static AWS profile credentials are required before Lambda preflight.",
      };
    }

    const failed =
      !summary.tools.aws.ok ||
      !summary.tools.gh.ok ||
      !summary.credentials.ok ||
      !summary.identity.ok ||
      !summary.lambda_preflight.ok;
    if (failed) summary.status = "failed";

    return {
      exitCode: failed ? 1 : 0,
      summary,
    };
  }
}

class SyncAwsGitHubSettingsUseCase {
  constructor({ maintenanceReader, githubSettingsWriter } = {}) {
    this.maintenanceReader = assertAwsMaintenanceReader(maintenanceReader);
    this.githubSettingsWriter = assertGitHubSettingsWriter(githubSettingsWriter);
  }

  async execute(rawOptions = {}) {
    const options = normalizeAwsOptions(rawOptions);
    const awsTool = requireTool(
      await this.maintenanceReader.getToolVersion("aws", ["--version"]),
      "aws"
    );
    const ghTool = requireTool(
      await this.maintenanceReader.getToolVersion("gh", ["--version"]),
      "gh"
    );
    const credentials = await this.maintenanceReader.readCredentials(options.profile);
    const identity = await this.maintenanceReader.getIdentity(options.profile);
    const preflight = await this.maintenanceReader.runKlinePreflight(options);
    if (!preflight.ok) {
      throw new Error(`AWS kline preflight failed: ${preflight.error}`);
    }

    const repo = await this.githubSettingsWriter.resolveRepository(rawOptions.repo);
    await this.githubSettingsWriter.setSecret({
      name: AWS_ACCESS_KEY_SECRET,
      repo,
      value: credentials.accessKeyId,
    });
    await this.githubSettingsWriter.setSecret({
      name: AWS_SECRET_KEY_SECRET,
      repo,
      value: credentials.secretAccessKey,
    });
    await this.githubSettingsWriter.setVariable({
      name: AWS_REGION_VARIABLE,
      repo,
      value: options.region,
    });

    return {
      status: "ok",
      profile: options.profile,
      region: options.region,
      preflight_region: options.preflightRegion ?? "config/default",
      lambda_name: options.lambdaName,
      repo,
      tools: {
        aws: awsTool.version,
        gh: ghTool.version,
      },
      identity,
      lambda_preflight: preflight,
      github: {
        secrets: [AWS_ACCESS_KEY_SECRET, AWS_SECRET_KEY_SECRET],
        variables: [AWS_REGION_VARIABLE],
      },
    };
  }
}

module.exports = {
  CheckAwsMaintenanceStatusUseCase,
  SyncAwsGitHubSettingsUseCase,
  requireTool,
};
