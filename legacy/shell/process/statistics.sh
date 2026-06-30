#!/bin/bash

# This script performs various statistical analyses on the data.

# --- Function: Calculate Yearly Positive Percentage Change ---
# Calculates the yearly count and percentage of rows where the percentage change of a given column is positive.
# Usage: yearly_positive_pct <column_name> [c12_value]
yearly_positive_pct() {
    local column_name=$1
    local c12_value=$2 # Optional c12 value to filter by
    local db_file="mydb.db"

    if [ -z "$column_name" ]; then
        echo "Error: Missing column name for yearly_positive_pct" >&2
        echo "Usage: $0 yearly_positive_pct <column_name> [c12_value]" >&2
        return 1
    fi

    local where_clause=""
    if [ -n "$c12_value" ]; then
        # Sanitize input
        sanitized_c12_value=$(echo "$c12_value" | sed "s/['\\\"]//g")
        where_clause="WHERE c12 = '$sanitized_c12_value'"
    fi

    # Use a heredoc for a robust multi-line SQL query
    local sql_query=$(cat <<-"EOF"
WITH Changes AS (
    SELECT
        c1,
        CASE
            WHEN LAG(${column_name}, 1, 0) OVER (PARTITION BY c12 ORDER BY c1) = 0 THEN NULL
            ELSE (${column_name} * 100.0 / LAG(${column_name}, 1, 0) OVER (PARTITION BY c12 ORDER BY c1)) - 100.0
        END AS percentage_change
    FROM
        py
    ${where_clause}
)
SELECT
    SUBSTR(c1, 1, 4) AS Year,
    COUNT(CASE WHEN percentage_change > 0 THEN 1 END) AS PositiveCount,
    printf('%.2f%%', CAST(COUNT(CASE WHEN percentage_change > 0 THEN 1 END) AS REAL) * 100 / COUNT(percentage_change)) AS Percentage
FROM
    Changes
WHERE
    percentage_change IS NOT NULL
GROUP BY
    Year
ORDER BY
    Year;
EOF
)

    # Execute the query
    sqlite3 -header -csv "$db_file" "$sql_query"
}




# --- Main Script Logic ---
# The first argument determines which function to run.
COMMAND=$1

if [ -z "$COMMAND" ]; then
    echo "Error: No command provided." >&2
    echo "Usage: $0 <command> [args...]" >&2
    echo "Available commands:" >&2
    echo "  yearly_positive_pct <column_name>" >&2
    exit 1
fi

# Shift to remove the command from the arguments list
shift

case "$COMMAND" in
    yearly_positive_pct)
        yearly_positive_pct "$@"
        ;; 
    *)
        echo "Error: Unknown command '$COMMAND'" >&2
        echo "Available commands:" >&2
        echo "  yearly_positive_pct <column_name>" >&2
        exit 1
        ;; 
esac
