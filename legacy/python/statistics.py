import sqlite3
import sys
import argparse

def yearly_positive_pct(column_name, c12_value=None):
    """
    Calculates the yearly count and percentage of rows where the percentage change
    of a given column is positive.
    Returns the data as a list of lists, including the header.
    """
    db_file = "mydb.db"

    where_clause = ""
    params = []
    if c12_value:
        where_clause = "WHERE c12 = ?"
        params.append(c12_value)

    sql_query = f"""
WITH Changes AS (
    SELECT
        c1,
        CASE
            WHEN LAG({column_name}, 1, 0) OVER (PARTITION BY c12 ORDER BY c1) = 0 THEN NULL
            ELSE ({column_name} * 100.0 / LAG({column_name}, 1, 0) OVER (PARTITION BY c12 ORDER BY c1)) - 100.0
        END AS percentage_change
    FROM
        py
    {where_clause}
)
SELECT
    SUBSTR(c1, 1, 4) AS Year,
    COUNT(percentage_change) AS TotalCount,
    COUNT(CASE WHEN percentage_change > 0 THEN 1 END) AS PositiveCount,
    COUNT(CASE WHEN percentage_change < 0 THEN 1 END) AS NegativeCount,
    COUNT(CASE WHEN percentage_change = 0 THEN 1 END) AS ZeroCount,
    printf('%.2f%%', CAST(COUNT(CASE WHEN percentage_change > 0 THEN 1 END) AS REAL) * 100 / COUNT(percentage_change)) AS PositivePercentage
FROM
    Changes
WHERE
    percentage_change IS NOT NULL
GROUP BY
    Year
ORDER BY
    Year;
"""

    try:
        with sqlite3.connect(db_file) as conn:
            cursor = conn.execute(sql_query, params)
            results = cursor.fetchall()
            header = [description[0] for description in cursor.description]
            return [header] + results

    except sqlite3.Error as e:
        print(f"Database error: {e}", file=sys.stderr)
        sys.exit(1)

def verify_statistics_data(data):
    """
    Verifies the consistency of the generated statistics data.
    """
    header = data[0]
    rows = data[1:]

    try:
        total_col = header.index("TotalCount")
        pos_col = header.index("PositiveCount")
        neg_col = header.index("NegativeCount")
        zero_col = header.index("ZeroCount")
    except ValueError as e:
        print(f"Error: Missing expected column in header: {e}", file=sys.stderr)
        return False

    print("Running verification...")
    
    all_rows_consistent = True
    for i, row in enumerate(rows):
        try:
            total = int(row[total_col])
            positive = int(row[pos_col])
            negative = int(row[neg_col])
            zero = int(row[zero_col])

            if total != positive + negative + zero:
                print(f"Inconsistency found in row {i+2}: {row}")
                print(f"  {total} != {positive} + {negative} + {zero}")
                all_rows_consistent = False

        except (ValueError, IndexError) as e:
            print(f"Error processing row {i+2}: {e}", file=sys.stderr)
            print(f"  Row content: {row}", file=sys.stderr)
            all_rows_consistent = False

    if all_rows_consistent:
        print(f"Verification successful: All {len(rows)} rows are consistent.")
    else:
        print("Verification failed: Inconsistencies were found.")
    
    return all_rows_consistent

def analyze_new_highs(year=None, date=None):
    """
    Analyzes new high breakouts.
    - If no args, shows yearly total breakout counts.
    - If --year is given, shows daily breakout counts for that year.
    - If --date is given, shows breakout stocks for that date with price and percentage.
    """
    db_file = "mydb.db"

    if year and date:
        print("Error: --year and --date cannot be used together.", file=sys.stderr)
        sys.exit(1)

    params = []
    if date:
        # Daily breakout details for a specific date
        sql_query = """
        WITH DailyWithPrevDay AS (
            SELECT
                c1,
                c12,
                c3,
                c13 AS prev_year_high,
                LAG(c3, 1, 0) OVER (PARTITION BY c12 ORDER BY c1) AS prev_day_c3
            FROM
                pd_xg
        )
        SELECT
            c12 AS StockCode,
            c3 AS Price,
            printf('%.2f%%', (c3 - prev_year_high) * 100.0 / prev_year_high) AS PctAboveHigh
        FROM
            DailyWithPrevDay
        WHERE
            c1 = ? AND c3 > prev_year_high AND prev_day_c3 <= prev_year_high AND prev_year_high > 0
        ORDER BY
            PctAboveHigh DESC;
        """
        params.append(date)
    else:
        # Yearly or daily total breakout counts
        base_sql = """
        WITH Breakouts AS (
            SELECT
                c1, c12, c3, c13 AS prev_year_high,
                LAG(c3, 1, 0) OVER (PARTITION BY c12, SUBSTR(c1, 1, 4) ORDER BY c1) AS prev_day_c3
            FROM pd_xg
        )
        SELECT {select_clause}
        FROM Breakouts
        WHERE c3 > prev_year_high AND prev_day_c3 <= prev_year_high AND prev_year_high > 0 {year_filter}
        GROUP BY {group_by_clause}
        ORDER BY {order_by_clause};
        """
        if year:
            select_clause = "c1 AS Date, COUNT(*) AS BreakoutCount"
            year_filter = "AND SUBSTR(c1, 1, 4) = ?"
            group_by_clause = "Date"
            order_by_clause = "Date"
            params.append(year)
        else:
            select_clause = "SUBSTR(c1, 1, 4) AS Year, COUNT(*) AS BreakoutCount"
            year_filter = ""
            group_by_clause = "Year"
            order_by_clause = "Year"

        sql_query = base_sql.format(
            select_clause=select_clause,
            year_filter=year_filter,
            group_by_clause=group_by_clause,
            order_by_clause=order_by_clause
        )

    try:
        with sqlite3.connect(db_file) as conn:
            cursor = conn.execute(sql_query, params)
            results = cursor.fetchall()
            header = [description[0] for description in cursor.description]
            
            print(','.join(header))
            for row in results:
                print(','.join(map(str, row)))

    except sqlite3.Error as e:
        print(f"Database error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="A script for analyzing and verifying yearly stock metric changes.",
        formatter_class=argparse.RawTextHelpFormatter
    )
    subparsers = parser.add_subparsers(dest="command", help="Available commands", required=True)

    # Common arguments for yearly-analysis and yearly-verify
    common_parser = argparse.ArgumentParser(add_help=False)
    common_parser.add_argument(
        "--metric-column", 
        required=True, 
        help="The column in the database to analyze (e.g., c4)."
    )
    common_parser.add_argument(
        "--stock-code", 
        help="Optional: A specific stock code (c12 value) to filter by."
    )

    # Sub-parser for the "yearly-analysis" command
    parser_analyze = subparsers.add_parser(
        "yearly-analysis", 
        help="Calculates and prints the yearly statistics for a given metric.",
        parents=[common_parser]
    )

    # Sub-parser for the "yearly-verify" command
    parser_verify = subparsers.add_parser(
        "yearly-verify", 
        help="Calculates and then verifies the yearly statistics for a given metric.",
        parents=[common_parser]
    )

    # Sub-parser for the "analyze-new-highs" command
    parser_new_highs = subparsers.add_parser(
        "analyze-new-highs", 
        help="Analyzes new high breakouts."
    )
    parser_new_highs.add_argument(
        "--year",
        help="Optional: A specific year to get daily breakout counts."
    )
    parser_new_highs.add_argument(
        "--date",
        help="Optional: A specific date to get breakout stocks with price and percentage."
    )

    args = parser.parse_args()

    if args.command == "yearly-analysis":
        data = yearly_positive_pct(args.metric_column, args.stock_code)
        for row in data:
            print(','.join(map(str, row)))

    elif args.command == "yearly-verify":
        data = yearly_positive_pct(args.metric_column, args.stock_code)
        verify_statistics_data(data)
        
    elif args.command == "analyze-new-highs":
        analyze_new_highs(args.year, args.date)