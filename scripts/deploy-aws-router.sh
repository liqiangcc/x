#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="default"
ROUTER_REGION="ap-northeast-1"
TARGET_REGIONS="ap-northeast-1,us-east-1,ap-northeast-2,ap-southeast-1,ap-southeast-2,us-west-2"
TARGET_NAME="kline-target"
ROUTER_NAME="kline-router"
MEMORY="128"
ROUTER_TIMEOUT="120"
TARGET_TIMEOUT="20"
ROUTER_TARGET_TIMEOUT_MS="18000"
ROUTER_MAX_FALLBACKS="6"
EASTMONEY_BASE_URL="http://push2his.eastmoney.com/api/qt/stock/kline/get"
EASTMONEY_TIMEOUT_MS="5000"
EASTMONEY_RETRIES="3"
ROTATE_ROUTER_TOKEN="0"

usage() {
  cat <<'USAGE'
Usage: scripts/deploy-aws-router.sh [options]

Options:
  --profile NAME                 AWS profile. Default: default
  --router-region REGION         Router Lambda region. Default: ap-northeast-1
  --target-regions r1,r2         Target Lambda regions.
  --target-name NAME             Target Lambda function name. Default: kline-target
  --router-name NAME             Router Lambda function name. Default: kline-router
  --memory MB                    Lambda memory. Default: 128
  --router-timeout SECONDS       Router Lambda timeout. Default: 120
  --target-timeout SECONDS       Target Lambda timeout. Default: 20
  --router-target-timeout-ms MS  Router per-target invoke timeout. Default: 18000
  --router-max-fallbacks N       Max auto fallback attempts. Default: 6
  --eastmoney-base-url URL       Eastmoney kline endpoint. Default: http://push2his.eastmoney.com/api/qt/stock/kline/get
  --eastmoney-timeout-ms MS      Target Eastmoney request timeout. Default: 5000
  --eastmoney-retries N          Target Eastmoney retry attempts. Default: 3
  --rotate-router-token          Generate and deploy a new ROUTER_TOKEN
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --router-region) ROUTER_REGION="$2"; shift 2 ;;
    --target-regions) TARGET_REGIONS="$2"; shift 2 ;;
    --target-name) TARGET_NAME="$2"; shift 2 ;;
    --router-name) ROUTER_NAME="$2"; shift 2 ;;
    --memory) MEMORY="$2"; shift 2 ;;
    --router-timeout) ROUTER_TIMEOUT="$2"; shift 2 ;;
    --target-timeout) TARGET_TIMEOUT="$2"; shift 2 ;;
    --router-target-timeout-ms) ROUTER_TARGET_TIMEOUT_MS="$2"; shift 2 ;;
    --router-max-fallbacks) ROUTER_MAX_FALLBACKS="$2"; shift 2 ;;
    --eastmoney-base-url) EASTMONEY_BASE_URL="$2"; shift 2 ;;
    --eastmoney-timeout-ms) EASTMONEY_TIMEOUT_MS="$2"; shift 2 ;;
    --eastmoney-retries) EASTMONEY_RETRIES="$2"; shift 2 ;;
    --rotate-router-token) ROTATE_ROUTER_TOKEN="1"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "$1 is required but was not found in PATH." >&2
    exit 1
  fi
}

aws_cmd() {
  aws --profile "$PROFILE" "$@"
}

function_exists() {
  local region="$1"
  local name="$2"
  aws_cmd lambda get-function --function-name "$name" --region "$region" >/dev/null 2>&1
}

role_exists() {
  aws_cmd iam get-role --role-name "$1" >/dev/null 2>&1
}

role_arn() {
  aws_cmd iam get-role --role-name "$1" --query 'Role.Arn' --output text
}

wait_function() {
  local region="$1"
  local name="$2"
  aws_cmd lambda wait function-updated --function-name "$name" --region "$region"
}

create_or_update_role() {
  local role_name="$1"
  local trust_file="$2"
  if role_exists "$role_name"; then
    aws_cmd iam update-assume-role-policy \
      --role-name "$role_name" \
      --policy-document "file://${trust_file}" >/dev/null
  else
    aws_cmd iam create-role \
      --role-name "$role_name" \
      --assume-role-policy-document "file://${trust_file}" >/dev/null
  fi
  aws_cmd iam attach-role-policy \
    --role-name "$role_name" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole >/dev/null
}

package_lambda() {
  local source_dir="$1"
  local package_dir="$2"
  local zip_file="$3"
  mkdir -p "$package_dir"
  cp "$source_dir/index.mjs" "$source_dir/package.json" "$package_dir/"
  if grep -q '"dependencies"' "$source_dir/package.json"; then
    (cd "$package_dir" && npm install --omit=dev --package-lock=false --silent)
  fi
  (cd "$package_dir" && zip -qr "$zip_file" .)
}

create_or_update_function() {
  local region="$1"
  local name="$2"
  local role="$3"
  local timeout="$4"
  local zip_file="$5"
  local env_file="${6:-}"
  local role_arn_value
  role_arn_value="$(role_arn "$role")"

  if function_exists "$region" "$name"; then
    aws_cmd lambda update-function-code \
      --function-name "$name" \
      --zip-file "fileb://${zip_file}" \
      --region "$region" >/dev/null
    wait_function "$region" "$name"
    local config_args=(
      lambda update-function-configuration
      --function-name "$name"
      --runtime nodejs22.x
      --handler index.handler
      --role "$role_arn_value"
      --timeout "$timeout"
      --memory-size "$MEMORY"
      --region "$region"
    )
    if [[ -n "$env_file" ]]; then
      config_args+=(--environment "file://${env_file}")
    fi
    aws_cmd "${config_args[@]}" >/dev/null
    wait_function "$region" "$name"
  else
    local create_args=(
      lambda create-function
      --function-name "$name"
      --runtime nodejs22.x
      --handler index.handler
      --role "$role_arn_value"
      --timeout "$timeout"
      --memory-size "$MEMORY"
      --zip-file "fileb://${zip_file}"
      --region "$region"
    )
    if [[ -n "$env_file" ]]; then
      create_args+=(--environment "file://${env_file}")
    fi
    aws_cmd "${create_args[@]}" >/dev/null
    wait_function "$region" "$name"
  fi
}

get_existing_router_token() {
  if ! function_exists "$ROUTER_REGION" "$ROUTER_NAME"; then
    return 1
  fi
  aws_cmd lambda get-function-configuration \
    --function-name "$ROUTER_NAME" \
    --region "$ROUTER_REGION" \
    --query 'Environment.Variables.ROUTER_TOKEN' \
    --output text 2>/dev/null | sed '/^None$/d'
}

ensure_router_function_url() {
  local url
  if url="$(aws_cmd lambda get-function-url-config --function-name "$ROUTER_NAME" --region "$ROUTER_REGION" --query 'FunctionUrl' --output text 2>/dev/null)"; then
    echo "$url"
  else
    url="$(aws_cmd lambda create-function-url-config --function-name "$ROUTER_NAME" --region "$ROUTER_REGION" --auth-type NONE --query 'FunctionUrl' --output text)"
    echo "$url"
  fi

  aws_cmd lambda add-permission \
    --function-name "$ROUTER_NAME" \
    --region "$ROUTER_REGION" \
    --statement-id FunctionURLAllowPublicAccess \
    --action lambda:InvokeFunctionUrl \
    --principal "*" \
    --function-url-auth-type NONE >/dev/null 2>&1 || true
}

require_tool aws
require_tool zip
require_tool node
require_tool npm
require_tool openssl

ACCOUNT_ID="$(aws_cmd sts get-caller-identity --query Account --output text)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

TRUST_FILE="$TMP_DIR/lambda-trust-policy.json"
cat > "$TRUST_FILE" <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
JSON

TARGET_ROLE="${TARGET_NAME}-execution-role"
ROUTER_ROLE="${ROUTER_NAME}-execution-role"
create_or_update_role "$TARGET_ROLE" "$TRUST_FILE"
create_or_update_role "$ROUTER_ROLE" "$TRUST_FILE"
sleep 10

TARGET_ZIP="$TMP_DIR/target.zip"
ROUTER_ZIP="$TMP_DIR/router.zip"
package_lambda "$ROOT/lambda/target-kline" "$TMP_DIR/target-package" "$TARGET_ZIP"
package_lambda "$ROOT/lambda/router" "$TMP_DIR/router-package" "$ROUTER_ZIP"

IFS=',' read -r -a TARGET_REGION_ARRAY <<< "$TARGET_REGIONS"
TARGET_ARNS=()
TARGETS_JSON="$(node -e '
const regions = process.argv[1].split(",").map((item) => item.trim()).filter(Boolean);
const functionName = process.argv[2];
console.log(JSON.stringify(Object.fromEntries(regions.map((region) => [region, { function_name: functionName }]))));
' "$TARGET_REGIONS" "$TARGET_NAME")"

TARGET_ENV_FILE="$TMP_DIR/target-env.json"
node -e '
const [baseUrl, timeoutMs, retries] = process.argv.slice(1);
console.log(JSON.stringify({
  Variables: {
    EASTMONEY_BASE_URL: baseUrl,
    EASTMONEY_TIMEOUT_MS: timeoutMs,
    EASTMONEY_RETRIES: retries,
  },
}, null, 2));
' "$EASTMONEY_BASE_URL" "$EASTMONEY_TIMEOUT_MS" "$EASTMONEY_RETRIES" > "$TARGET_ENV_FILE"

for region in "${TARGET_REGION_ARRAY[@]}"; do
  region="$(echo "$region" | xargs)"
  [[ -z "$region" ]] && continue
  create_or_update_function "$region" "$TARGET_NAME" "$TARGET_ROLE" "$TARGET_TIMEOUT" "$TARGET_ZIP" "$TARGET_ENV_FILE"
  TARGET_ARNS+=("arn:aws:lambda:${region}:${ACCOUNT_ID}:function:${TARGET_NAME}")
done

ROUTER_POLICY_FILE="$TMP_DIR/router-invoke-policy.json"
node -e '
const resources = process.argv.slice(1);
console.log(JSON.stringify({
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Action: "lambda:InvokeFunction",
      Resource: resources,
    },
  ],
}, null, 2));
' "${TARGET_ARNS[@]}" > "$ROUTER_POLICY_FILE"
aws_cmd iam put-role-policy \
  --role-name "$ROUTER_ROLE" \
  --policy-name "${ROUTER_NAME}-invoke-targets" \
  --policy-document "file://${ROUTER_POLICY_FILE}" >/dev/null

ROUTER_TOKEN="$(get_existing_router_token || true)"
if [[ "$ROTATE_ROUTER_TOKEN" == "1" || -z "$ROUTER_TOKEN" ]]; then
  ROUTER_TOKEN="$(openssl rand -hex 32)"
fi

ROUTER_ENV_FILE="$TMP_DIR/router-env.json"
node -e '
const [routerToken, targetsJson, maxFallbacks, targetTimeoutMs] = process.argv.slice(1);
console.log(JSON.stringify({
  Variables: {
    ROUTER_TOKEN: routerToken,
    TARGETS_JSON: targetsJson,
    ROUTER_MAX_FALLBACKS: maxFallbacks,
    ROUTER_TARGET_TIMEOUT_MS: targetTimeoutMs,
  },
}, null, 2));
' "$ROUTER_TOKEN" "$TARGETS_JSON" "$ROUTER_MAX_FALLBACKS" "$ROUTER_TARGET_TIMEOUT_MS" > "$ROUTER_ENV_FILE"

create_or_update_function "$ROUTER_REGION" "$ROUTER_NAME" "$ROUTER_ROLE" "$ROUTER_TIMEOUT" "$ROUTER_ZIP" "$ROUTER_ENV_FILE"
ROUTER_URL="$(ensure_router_function_url)"

cat <<OUTPUT
Router URL:
  ${ROUTER_URL}

Target ARNs:
$(printf '  %s\n' "${TARGET_ARNS[@]}")

Configure GitHub secrets:
  printf '%s\n' '${ROUTER_URL}' | gh secret set AWS_ROUTER_URL
  printf '%s\n' '${ROUTER_TOKEN}' | gh secret set AWS_ROUTER_TOKEN

Local test:
  AWS_ROUTER_URL='${ROUTER_URL}' AWS_ROUTER_TOKEN='${ROUTER_TOKEN}' bin/x aws probe-router --secid 1.600519 --period daily
  AWS_ROUTER_URL='${ROUTER_URL}' AWS_ROUTER_TOKEN='${ROUTER_TOKEN}' bin/x kline fetch 000001 --period daily --engine aws-router
OUTPUT
