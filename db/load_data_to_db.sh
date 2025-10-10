#!/bin/bash
# Loads data from a CSV file into a SQLite database table.

set -e # Exit immediately if a command exits with a non-zero status.

# --- Input Validation ---
if [ "$#" -ne 3 ]; then
    echo "Usage: $0 <db_file> <table_name> <csv_file>"
    exit 1
fi

db_file=$1
table_name=$2
csv_file=$3

echo "Loading data from '$csv_file' into table '$table_name' in database '$db_file'..."

if [ ! -f "$csv_file" ]; then
    echo "Error: CSV file not found at '$csv_file'"
    exit 1
fi

# Import data into SQLite
sqlite3 "$db_file" <<EOF
.mode csv
.import "$csv_file" "$table_name"
EOF

echo "Data loaded successfully."
