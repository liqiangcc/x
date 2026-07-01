#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGION="cn-east-3"
REGIONS=""
ALL_REGIONS="0"
PROJECT_ID=""
FUNCTION_NAME="x-kline-target"
PACKAGE="default"
RUNTIME="Node.js18.15"
HANDLER="index.handler"
MEMORY="128"
TIMEOUT="20"
OUTPUT_FILE=""
TARGETS_OUTPUT_FILE=""
STRICT="0"

usage() {
  cat <<'USAGE'
Usage: scripts/deploy-huaweicloud-functiongraph.sh [options]

Options:
  --region REGION        FunctionGraph region. Use "all" to deploy to all enabled projects.
                         Default: cn-east-3
  --regions r1,r2        Comma-separated FunctionGraph regions.
  --all-regions          Deploy to all enabled region projects returned by IAM.
  --project-id ID        FunctionGraph project ID. Only valid for single-region deploy.
  --function-name NAME   Function name. Default: x-kline-target
  --package NAME         Function package/group. Default: default
  --memory MB            Function memory. Default: 128
  --timeout SECONDS      Function timeout. Default: 20
  --output FILE          Write deployment summary as TSV.
  --targets-output FILE  Write deployed targets as JSON for latency benchmark.
  --strict               In multi-region mode, exit non-zero if any region fails.
  --help, -h             Show this help.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --region) REGION="$2"; shift 2 ;;
    --regions) REGIONS="$2"; shift 2 ;;
    --all-regions) ALL_REGIONS="1"; shift ;;
    --project-id) PROJECT_ID="$2"; shift 2 ;;
    --function-name) FUNCTION_NAME="$2"; shift 2 ;;
    --package) PACKAGE="$2"; shift 2 ;;
    --memory) MEMORY="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --output) OUTPUT_FILE="$2"; shift 2 ;;
    --targets-output) TARGETS_OUTPUT_FILE="$2"; shift 2 ;;
    --strict) STRICT="1"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

if [[ "$REGION" == "all" ]]; then
  ALL_REGIONS="1"
fi

if [[ "$ALL_REGIONS" == "1" && -n "$PROJECT_ID" ]]; then
  echo "--project-id can only be used with a single region." >&2
  exit 1
fi

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "$1 is required but was not found in PATH." >&2
    exit 1
  fi
}

validate_hcloud_output() {
  local output_file="$1"
  node -e '
const fs = require("node:fs");
const raw = fs.readFileSync(process.argv[1], "utf8").trim();
if (!raw) {
  process.exit(0);
}
try {
  const payload = JSON.parse(raw);
  if (payload && (payload.error_code || payload.error_msg)) {
    console.error(raw);
    process.exit(1);
  }
} catch {
  if (/\[(USE_ERROR|OPENAPI_ERROR)\]|error_code|error_msg|not authorized|forbidden|Failed to obtain project ID/i.test(raw)) {
    console.error(raw);
    process.exit(1);
  }
  console.error(raw);
  process.exit(1);
}
' "$output_file"
}

run_hcloud_json() {
  local output_file="$1"
  shift
  if ! "$@" > "$output_file" 2>&1; then
    cat "$output_file" >&2
    return 1
  fi
  validate_hcloud_output "$output_file"
}

project_id_for_region() {
  local projects_file="$1"
  local region="$2"
  node -e '
const fs = require("node:fs");
const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const region = process.argv[2];
const project = (report.projects || []).find((item) => item.name === region && item.enabled !== false);
if (project && project.id) {
  process.stdout.write(project.id);
}
' "$projects_file" "$region"
}

function_urn() {
  local functions_file="$1"
  node -e '
const fs = require("node:fs");
const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const name = process.argv[2];
const item = (report.functions || []).find((fn) => fn.func_name === name);
if (item && item.func_urn) {
  process.stdout.write(item.func_urn);
}
' "$functions_file" "$FUNCTION_NAME"
}

enabled_project_regions() {
  local projects_file="$1"
  node -e '
const fs = require("node:fs");
const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const rows = (report.projects || [])
  .filter((project) => project.enabled !== false && project.id && /^[a-z]{2}-/.test(project.name))
  .map((project) => `${project.name}\t${project.id}`)
  .sort((left, right) => left.localeCompare(right));
for (const row of rows) {
  console.log(row);
}
' "$projects_file"
}

summary_escape() {
  tr '\n\t' '  ' | sed 's/[[:space:]][[:space:]]*/ /g; s/^ //; s/ $//'
}

require_tool base64
require_tool hcloud
require_tool node
require_tool zip

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

PACKAGE_DIR="$TMP_DIR/package"
ZIP_FILE="$TMP_DIR/function.zip"
PROJECTS_FILE="$TMP_DIR/projects.json"
SUMMARY_FILE="$TMP_DIR/summary.tsv"
mkdir -p "$PACKAGE_DIR"
cp "$ROOT/lambda/huaweicloud-target-kline/index.js" "$ROOT/lambda/huaweicloud-target-kline/package.json" "$PACKAGE_DIR/"
(cd "$PACKAGE_DIR" && zip -qr "$ZIP_FILE" .)
CODE_BASE64="$(base64 -w 0 "$ZIP_FILE")"

run_hcloud_json "$PROJECTS_FILE" hcloud IAM KeystoneListProjects --cli-output=json

TARGETS_FILE="$TMP_DIR/targets.tsv"
if [[ "$ALL_REGIONS" == "1" ]]; then
  enabled_project_regions "$PROJECTS_FILE" > "$TARGETS_FILE"
elif [[ -n "$REGIONS" ]]; then
  : > "$TARGETS_FILE"
  IFS=',' read -r -a REGION_ARRAY <<< "$REGIONS"
  for target_region in "${REGION_ARRAY[@]}"; do
    target_region="$(echo "$target_region" | xargs)"
    [[ -z "$target_region" ]] && continue
    target_project_id="$(project_id_for_region "$PROJECTS_FILE" "$target_region")"
    printf "%s\t%s\n" "$target_region" "$target_project_id" >> "$TARGETS_FILE"
  done
else
  target_project_id="$PROJECT_ID"
  if [[ -z "$target_project_id" ]]; then
    target_project_id="$(project_id_for_region "$PROJECTS_FILE" "$REGION")"
  fi
  printf "%s\t%s\n" "$REGION" "$target_project_id" > "$TARGETS_FILE"
fi

if [[ ! -s "$TARGETS_FILE" ]]; then
  echo "No deployment targets were resolved." >&2
  exit 1
fi

deploy_region() {
  local target_region="$1"
  local target_project_id="$2"
  local functions_file="$TMP_DIR/functions-${target_region}.json"
  local action_file="$TMP_DIR/action-${target_region}.json"
  local project_args=()
  if [[ -n "$target_project_id" ]]; then
    project_args+=(--project_id="$target_project_id")
  fi

  run_hcloud_json "$functions_file" \
    hcloud FunctionGraph ListFunctions \
    --cli-region="$target_region" \
    "${project_args[@]}" \
    --cli-output=json || return 1

  local urn
  urn="$(function_urn "$functions_file")"
  if [[ -n "$urn" ]]; then
    run_hcloud_json "$action_file" \
      hcloud FunctionGraph UpdateFunctionCode \
      --cli-region="$target_region" \
      "${project_args[@]}" \
      --function_urn="$urn" \
    --code_type=zip \
    --code_filename=function.zip \
    --func_code.file="$CODE_BASE64" \
    --cli-output=json || return 1

    run_hcloud_json "$action_file" \
      hcloud FunctionGraph UpdateFunctionConfig \
      --cli-region="$target_region" \
      "${project_args[@]}" \
      --function_urn="$urn" \
      --func_name="$FUNCTION_NAME" \
      --handler="$HANDLER" \
      --memory_size="$MEMORY" \
      --runtime="$RUNTIME" \
      --timeout="$TIMEOUT" \
      --cli-output=json || return 1
  else
    run_hcloud_json "$action_file" \
      hcloud FunctionGraph CreateFunction \
      --cli-region="$target_region" \
      "${project_args[@]}" \
      --func_name="$FUNCTION_NAME" \
      --package="$PACKAGE" \
      --runtime="$RUNTIME" \
      --handler="$HANDLER" \
      --memory_size="$MEMORY" \
      --timeout="$TIMEOUT" \
      --code_type=zip \
      --code_filename=function.zip \
      --func_code.file="$CODE_BASE64" \
      --cli-output=json || return 1
  fi

  run_hcloud_json "$functions_file" \
    hcloud FunctionGraph ListFunctions \
    --cli-region="$target_region" \
    "${project_args[@]}" \
    --cli-output=json || return 1

  urn="$(function_urn "$functions_file")"
  if [[ -z "$urn" ]]; then
    echo "Function was deployed but its URN could not be resolved." >&2
    return 1
  fi
  printf "%s" "$urn"
}

printf "region\tproject_id\tstatus\tfunction_name\tfunction_urn\tmessage\n" > "$SUMMARY_FILE"
success_count=0
failure_count=0
total_count=0
single_target="0"
if [[ "$ALL_REGIONS" != "1" && -z "$REGIONS" ]]; then
  single_target="1"
fi

while IFS=$'\t' read -r target_region target_project_id; do
  [[ -z "$target_region" ]] && continue
  total_count=$((total_count + 1))
  echo "Deploying $FUNCTION_NAME to $target_region..."
  deploy_output_file="$TMP_DIR/deploy-${target_region}.out"
  if deploy_region "$target_region" "$target_project_id" > "$deploy_output_file" 2>&1; then
    urn="$(cat "$deploy_output_file")"
    printf "%s\t%s\t%s\t%s\t%s\t%s\n" \
      "$target_region" "$target_project_id" "deployed" "$FUNCTION_NAME" "$urn" "" >> "$SUMMARY_FILE"
    echo "  ok: $urn"
    success_count=$((success_count + 1))
  else
    message="$(summary_escape < "$deploy_output_file")"
    printf "%s\t%s\t%s\t%s\t%s\t%s\n" \
      "$target_region" "$target_project_id" "failed" "$FUNCTION_NAME" "" "$message" >> "$SUMMARY_FILE"
    echo "  failed: $message" >&2
    failure_count=$((failure_count + 1))
    if [[ "$single_target" == "1" || "$STRICT" == "1" ]]; then
      cat "$SUMMARY_FILE"
      [[ -n "$OUTPUT_FILE" ]] && cp "$SUMMARY_FILE" "$OUTPUT_FILE"
      exit 1
    fi
  fi
done < "$TARGETS_FILE"

echo
cat "$SUMMARY_FILE"

if [[ -n "$OUTPUT_FILE" ]]; then
  cp "$SUMMARY_FILE" "$OUTPUT_FILE"
  echo "summary: $OUTPUT_FILE"
fi

if [[ -n "$TARGETS_OUTPUT_FILE" ]]; then
  node -e '
const fs = require("node:fs");
const path = require("node:path");
const [summaryPath, outputPath] = process.argv.slice(1);
const lines = fs.readFileSync(summaryPath, "utf8").trim().split(/\n/);
const targets = {};
for (const line of lines.slice(1)) {
  const [region, projectId, status, , functionUrn] = line.split("\t");
  if (status === "deployed" && region && projectId && functionUrn) {
    targets[region] = {
      project_id: projectId,
      function_urn: functionUrn,
    };
  }
}
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(targets, null, 2)}\n`);
' "$SUMMARY_FILE" "$TARGETS_OUTPUT_FILE"
  echo "targets: $TARGETS_OUTPUT_FILE"
fi

echo
echo "deployed=$success_count failed=$failure_count total=$total_count"
if [[ "$success_count" -eq 0 ]]; then
  exit 1
fi
if [[ "$STRICT" == "1" && "$failure_count" -gt 0 ]]; then
  exit 1
fi
