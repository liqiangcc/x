#!/bin/bash
TABLE_NAME="etf_info"
./api/call_ttjj_api.sh get_etfs 2>/dev/null | \
jq -r --arg TABLE_NAME "$TABLE_NAME" '
  .result.data[] |
  .SECURITY_CODE as $code |
  .SECURITY_NAME_ABBR as $name |
  .NEW_PRICE as $price |
  .CHANGE_RATE as $rate |
  .CHANGE as $change |
  .VOLUME as $volume |
  .DEAL_AMOUNT as $amount |
  .INDEX_NAME as $index |
  "INSERT INTO " + $TABLE_NAME + " (SECURITY_CODE, SECURITY_NAME_ABBR, NEW_PRICE, CHANGE_RATE, CHANGE, VOLUME, DEAL_AMOUNT, INDEX_NAME) VALUES (" +
  "'" + ($code // "") + "', " + "'" + ($name // "") + "', " + ($price | tostring) + ", " + ($rate | tostring) + ", " + ($change | tostring) + ", " + ($volume | tostring) + ", " + ($amount | tostring) + ", " + "'" + ($index // "") + "'" +
  ") ON CONFLICT(SECURITY_CODE) DO UPDATE SET " +
  "SECURITY_NAME_ABBR = excluded.SECURITY_NAME_ABBR, NEW_PRICE = excluded.NEW_PRICE, CHANGE_RATE = excluded.CHANGE_RATE, CHANGE = excluded.CHANGE, VOLUME = excluded.VOLUME, DEAL_AMOUNT = excluded.DEAL_AMOUNT, INDEX_NAME = excluded.INDEX_NAME, update_time = CURRENT_TIMESTAMP;"
'
