#!/bin/bash
# Fetches data for a given code and formats it into a CSV file.

set -e # Exit immediately if a command exits with a non-zero status.

# --- Input Validation ---
if [ "$#" -ne 3 ]; then
    echo "Usage: $0 <stock_code> <days> <output_csv_file>"
    exit 1
fi

code=$1
n=$2
csv_file=$3

echo "Fetching data for code '$code'"...

# Clean up previous file
rm -f "$csv_file"

# Fetch and format data
# The hardcoded values 106 and 20500207 are kept from the original script.
bash q.sh "$code" 106 "$n" 20500207 | jq -r --arg code "$code" '.data.klines[] | "\(.),\($code)"' > "$csv_file"

# Log number of lines
l=$(cat "$csv_file" | wc -l)
echo "Successfully fetched $l lines of data into $csv_file"
