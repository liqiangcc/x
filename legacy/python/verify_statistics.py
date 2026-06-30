import sys
import csv

def verify_statistics():
    """
    Reads CSV data from standard input and verifies the consistency of the counts.
    """
    reader = csv.reader(sys.stdin)
    
    # Read header
    try:
        header = next(reader)
    except StopIteration:
        print("Error: Input is empty.", file=sys.stderr)
        sys.exit(1)

    # Find column indices
    try:
        total_col = header.index("TotalCount")
        pos_col = header.index("PositiveCount")
        neg_col = header.index("NegativeCount")
        zero_col = header.index("ZeroCount")
    except ValueError as e:
        print(f"Error: Missing expected column in header: {e}", file=sys.stderr)
        sys.exit(1)

    print("Running verification...")
    
    all_rows_consistent = True
    row_count = 0
    for i, row in enumerate(reader):
        row_count += 1
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
        print(f"Verification successful: All {row_count} rows are consistent.")
    else:
        print("Verification failed: Inconsistencies were found.")

if __name__ == "__main__":
    verify_statistics()
