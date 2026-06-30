#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
FETCH_SCRIPT="${SCRIPT_DIR}/fetch/fetch_pool.js"
ENGINE="${1:-node}"
DEFAULT_DATE="${2:-$(date +%Y%m%d)}"

if [[ "$ENGINE" != "node" && "$ENGINE" != "curl" ]]; then
  echo "Usage: $0 [node|curl] [YYYYMMDD]" >&2
  exit 1
fi

run_pool_test() {
  local pool="$1"
  local date_value="$2"
  local output_file
  local error_file
  local attempt

  output_file=$(mktemp)
  error_file=$(mktemp)

  for attempt in 1 2 3; do
    if node "$FETCH_SCRIPT" "$pool" "$date_value" --engine "$ENGINE" --json >"$output_file" 2>"$error_file"; then
      node -e '
const fs = require("node:fs");
const pool = process.argv[2];
const file = process.argv[3];
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const count = Array.isArray(data?.data?.pool) ? data.data.pool.length : -1;
console.log(`PASS ${pool} rc=${data.rc} qdate=${data?.data?.qdate ?? "NA"} count=${count}`);
' "$0" "$pool" "$output_file"
      rm -f "$output_file" "$error_file"
      return 0
    fi

    sleep "$attempt"
  done

  echo "FAIL ${pool} date=${date_value} engine=${ENGINE} reason=$(tail -n 1 "$error_file")"
  rm -f "$output_file" "$error_file"
  return 1
}

failures=0

run_pool_test dt "$DEFAULT_DATE" || failures=$((failures + 1))
run_pool_test qs "$DEFAULT_DATE" || failures=$((failures + 1))
run_pool_test zb "$DEFAULT_DATE" || failures=$((failures + 1))
run_pool_test zt "$DEFAULT_DATE" || failures=$((failures + 1))

if [[ "$failures" -gt 0 ]]; then
  echo "SUMMARY FAILURES=${failures}"
  exit 1
fi

echo "SUMMARY OK"
