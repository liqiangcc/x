#!/bin/bash
# Orchestrates fetching stock data and loading it into a database.

set -e # Exit immediately if a command exits with a non-zero status.

# --- Configuration ---
db_file="mydb.db"
table_name="py"
csv_file="data.csv"
# The '12' for createTable.sh was hardcoded in the original script.
table_columns=12

# --- Input Validation ---
if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <stock_code> <days>"
    exit 1
fi

code=$1
n=$2

# --- Main Workflow ---

# 1. Create database table if it doesn't exist
echo "Step 1: Preparing database table..."
bash createTable.sh "$db_file" "$table_name" "$table_columns"
echo "Table preparation complete."
echo

# 2. Fetch data into CSV file
echo "Step 2: Fetching data..."
bash fetch_data.sh "$code" "$n" "$csv_file"
echo "Data fetching complete."
echo

# 3. Load data from CSV into the database
echo "Step 3: Loading data into database..."
bash load_data_to_db.sh "$db_file" "$table_name" "$csv_file"
echo "Data loading complete."
echo

# Optional: Clean up the temporary CSV file
# rm -f "$csv_file"

echo "Process finished successfully."