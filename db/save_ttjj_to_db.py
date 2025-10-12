import sqlite3
import subprocess
import json
import sys
import os
import time
from datetime import datetime, timedelta

def main():
    """Main function to fetch and save data."""
    
    # --- Configuration ---
    # Set working directory to project root
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    os.chdir(project_root)
    
    DB_FILE = "db/stocks.db"
    API_SCRIPT = "api/call_ttjj_api.sh"

    # --- Argument Parsing ---
    if len(sys.argv) < 2:
        print("Usage: python save_ttjj_to_db.py <command> [args]", file=sys.stderr)
        print("Commands:", file=sys.stderr)
        print("  etf_info                - Fetches and saves ETF information.", file=sys.stderr)
        print("  etf_klines <klt>        - Fetches and saves ETF k-line data.", file=sys.stderr)
        print("    <klt>: 101 for daily, 102 for weekly, 103 for monthly.", file=sys.stderr)
        print("  check_failed <klt>      - Checks for ETFs that failed to save for a given k-line type.", file=sys.stderr)
        sys.exit(1)

    command = sys.argv[1]

    # --- Main Logic ---
    if command == "etf_info":
        process_etf_info(DB_FILE, API_SCRIPT)
    elif command == "etf_klines":
        if len(sys.argv) != 3:
            print("Error: Missing <klt> argument for etf_klines.", file=sys.stderr)
            sys.exit(1)
        klt = sys.argv[2]
        process_etf_klines(DB_FILE, API_SCRIPT, klt)
    elif command == "check_failed":
        if len(sys.argv) != 3:
            print("Error: Missing <klt> argument for check_failed.", file=sys.stderr)
            sys.exit(1)
        klt = sys.argv[2]
        check_failed_etfs(DB_FILE, klt)
    else:
        print(f"Error: Unsupported command '{command}'", file=sys.stderr)
        sys.exit(1)

def process_etf_info(db_file, api_script):
    """Fetches, parses, and imports ETF data into the database."""
    print(f"Processing: etf_info", flush=True)

    def initialize_database(db_file_path):
        """Initializes the database by executing the schema file."""
        print("Initializing database schema from file...", flush=True)
        try:
            with open('db/database_schema.sql', 'r', encoding='utf-8') as f:
                schema_sql = f.read()
            
            conn = sqlite3.connect(db_file_path)
            cursor = conn.cursor()
            cursor.executescript(schema_sql)
            conn.commit()
            conn.close()
            print("Database schema initialized successfully.", flush=True)
        except FileNotFoundError:
            print("Error: 'db/database_schema.sql' not found.", file=sys.stderr)
            sys.exit(1)
        except sqlite3.Error as e:
            print(f"Database initialization error: {e}", file=sys.stderr)
            sys.exit(1)

    # Initialize schema before processing
    initialize_database(db_file)

    try:
        conn = sqlite3.connect(db_file)
        cursor = conn.cursor()

        # 2. Fetch data from API script
        print("Fetching ETF data via API...", flush=True)
        result = subprocess.run(
            ["bash", api_script, "get_etfs"],
            capture_output=True,
            text=True,
            check=True,
            encoding='utf-8'
        )
        
        etf_data = json.loads(result.stdout)

        # 3. Prepare data and Insert/update
        print("Preparing and importing data into the database...", flush=True)
        if not etf_data or 'result' not in etf_data or 'data' not in etf_data['result']:
            print("Warning: No data received from the API.", flush=True)
            return

        # Prepare data for import
        data_to_import = etf_data['result']['data']
        total_records = len(data_to_import)
        print(f"Found {total_records} ETFs to process.", flush=True)

        sql = """
        INSERT INTO etf_info (
            SECURITY_CODE, MARKET, SECURITY_NAME_ABBR, NEW_PRICE, CHANGE_RATE, CHANGE, VOLUME, DEAL_AMOUNT, INDEX_NAME,
            name, scale, establishment_date, fund_type, fund_manager, management_company, fund_rating
        ) VALUES (
            :SECURITY_CODE, :MARKET, :SECURITY_NAME_ABBR, :NEW_PRICE, :CHANGE_RATE, :CHANGE, :VOLUME, :DEAL_AMOUNT, :INDEX_NAME,
            :name, :scale, :establishment_date, :fund_type, :fund_manager, :management_company, :fund_rating
        ) ON CONFLICT(SECURITY_CODE) DO UPDATE SET
            MARKET = excluded.MARKET,
            SECURITY_NAME_ABBR = excluded.SECURITY_NAME_ABBR,
            NEW_PRICE = excluded.NEW_PRICE,
            CHANGE_RATE = excluded.CHANGE_RATE,
            CHANGE = excluded.CHANGE,
            VOLUME = excluded.VOLUME,
            DEAL_AMOUNT = excluded.DEAL_AMOUNT,
            INDEX_NAME = excluded.INDEX_NAME,
            name = excluded.name,
            scale = excluded.scale,
            establishment_date = excluded.establishment_date,
            fund_type = excluded.fund_type,
            fund_manager = excluded.fund_manager,
            management_company = excluded.management_company,
            fund_rating = excluded.fund_rating,
            update_time = CURRENT_TIMESTAMP;
        """

        imported_count = 0
        for i, record in enumerate(data_to_import):
            # --- Basic Info ---
            if 'SECUCODE' in record and '.' in record['SECUCODE']:
                code, market = record['SECUCODE'].split('.', 1)
                record['SECURITY_CODE'] = code
                record['MARKET'] = market
            else:
                record['MARKET'] = record.get('MARKET')
                if 'SECURITY_CODE' not in record:
                    record['SECURITY_CODE'] = record.get('SECUCODE')

            security_code = record.get('SECURITY_CODE')
            if not security_code:
                print(f"Warning: Skipping record due to missing SECURITY_CODE. Record: {record}", file=sys.stderr)
                continue

            # --- Fetch Details ---
            print(f"[{i+1}/{total_records}] Fetching details for {security_code}...", flush=True)
            try:
                details_result = subprocess.run(
                    ["bash", api_script, "get_etf_details", security_code],
                    capture_output=True, text=True, check=True, encoding='utf-8'
                )
                details_data = json.loads(details_result.stdout)
                
                # Merge details into the record
                record['name'] = details_data.get('name')
                record['scale'] = details_data.get('scale')
                record['establishment_date'] = details_data.get('establishment_date')
                record['fund_type'] = details_data.get('type')
                record['fund_manager'] = details_data.get('fund_manager')
                record['management_company'] = details_data.get('management_company')
                record['fund_rating'] = details_data.get('fund_rating')

                #time.sleep(1) # Be nice to the API

            except subprocess.CalledProcessError as e:
                print(f"Warning: Failed to fetch details for {security_code}. Stderr: {e.stderr}", file=sys.stderr)
            except json.JSONDecodeError as e:
                print(f"Warning: Failed to decode JSON for {security_code}. Output: {details_result.stdout}", file=sys.stderr)

            # --- Insert record ---
            try:
                cursor.execute(sql, record)
                imported_count += 1
            except sqlite3.Error as e:
                print(f"Database error for record {record.get('SECURITY_CODE')}: {e}", file=sys.stderr)

            # --- Commit in batches ---
            if (i + 1) % 100 == 0:
                conn.commit()
                print(f"--- Committed batch of 100 records ({i+1}/{total_records}) ---", flush=True)

        conn.commit() # Commit any remaining records
        print(f"Successfully imported/updated {imported_count} of {total_records} records into 'etf_info' table.", flush=True)

    except FileNotFoundError:
        print(f"Error: API script '{api_script}' not found.", file=sys.stderr)
        sys.exit(1)
    except subprocess.CalledProcessError as e:
        print(f"Error calling API script: {e}", file=sys.stderr)
        print(f"Stderr: {e.stderr}", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"Error decoding JSON from API script: {e}", file=sys.stderr)
        print(f"API script output was: {result.stdout}", file=sys.stderr)
        sys.exit(1)
    except sqlite3.Error as e:
        print(f"Database error: {e}", file=sys.stderr)
        if 'conn' in locals() and conn:
            conn.rollback()
        sys.exit(1)
    finally:
        if 'conn' in locals() and conn:
            conn.close()
        print("Script finished.", flush=True)

def process_etf_klines(db_file, api_script, klt):
    """Fetches and saves k-line data for all ETFs in the etf_info table."""
    print(f"Processing ETF k-lines for klt={klt}", flush=True)

    try:
        conn = sqlite3.connect(db_file)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # 1. Get all ETFs from etf_info
        try:
            cursor.execute("SELECT SECURITY_CODE, MARKET FROM etf_info")
            etfs = cursor.fetchall()
        except sqlite3.OperationalError as e:
            if "no such table" in str(e):
                print("Error: 'etf_info' table not found. Please run the 'etf_info' command first to initialize the database.", file=sys.stderr)
                sys.exit(1)
            else:
                raise  # Re-raise other operational errors
        
        if not etfs:
            print("No ETFs found in etf_info table. Run 'etf_info' command first.", file=sys.stderr)
            return

        print(f"Found {len(etfs)} ETFs to process.", flush=True)

        # --- Pre-fetch latest market timestamp ---
        latest_api_timestamp = ""
        if etfs:
            print("Fetching latest market timestamp from a sample ETF...", flush=True)
            try:
                sample_etf = etfs[0]
                security_code = sample_etf['SECURITY_CODE']
                market = sample_etf['MARKET']
                market_id_map = {'SH': '1', 'SZ': '0'}

                if market in market_id_map:
                    market_id = market_id_map[market]
                    secid = f"{market_id}.{security_code}"
                    
                    result = subprocess.run(
                        ["bash", api_script, "get_kline", secid, klt, "10000", datetime.now().strftime('%Y%m%d')],
                        capture_output=True, text=True, check=True, encoding='utf-8'
                    )
                    kline_data = json.loads(result.stdout)

                    if kline_data and kline_data.get('data') and kline_data['data'].get('klines'):
                        latest_api_timestamp = kline_data['data']['klines'][-1].split(',')[0]
                        print(f"Latest market timestamp found: {latest_api_timestamp}", flush=True)
                    else:
                        print("Warning: Could not determine latest market timestamp from sample. Will fetch for each ETF if needed.", flush=True)
                else:
                    print("Warning: Sample ETF has unknown market. Skipping pre-fetch check.", file=sys.stderr)

            except (subprocess.CalledProcessError, json.JSONDecodeError, IndexError) as e:
                print(f"Warning: Could not determine latest market timestamp due to an error: {e}. Will fetch for each ETF if needed.", file=sys.stderr)
        # --- End of pre-fetch ---

        # 2. Loop through ETFs and fetch k-lines
        total_klines_imported = 0
        for i, etf in enumerate(etfs):
            security_code = etf['SECURITY_CODE']
            market = etf['MARKET']

            if not market or not security_code:
                print(f"Skipping ETF with missing market or code: {etf}", file=sys.stderr)
                continue

            # Convert market to market_id
            market_id_map = {'SH': '1', 'SZ': '0'}
            if market not in market_id_map:
                print(f"Skipping ETF with unknown market: {market}", file=sys.stderr)
                continue
            market_id = market_id_map[market]
            
            secid = f"{market_id}.{security_code}"
            end_date = datetime.now().strftime('%Y%m%d')
            limit = "10000" # Fetch a large number of data points

            try:
                # Get the latest timestamp from the database for the current ETF
                cursor.execute("SELECT MAX(timestamp) FROM etf_klines WHERE secid = ? AND klt = ?", (secid, klt))
                row = cursor.fetchone()
                latest_db_timestamp = row[0] if row and row[0] else ""

                # Check against the pre-fetched market timestamp
                if latest_api_timestamp and latest_db_timestamp >= latest_api_timestamp:
                    print(f"[{i+1}/{len(etfs)}] Data for {secid} is up to date ({latest_db_timestamp}). Skipping.", flush=True)
                    continue

                print(f"[{i+1}/{len(etfs)}] Fetching k-lines for {secid}...", flush=True)

                result = subprocess.run(
                    ["bash", api_script, "get_kline", secid, klt, limit, end_date],
                    capture_output=True,
                    text=True,
                    check=True,
                    encoding='utf-8'
                )
                kline_data = json.loads(result.stdout)

                if not kline_data or 'data' not in kline_data or not kline_data['data'] or 'klines' not in kline_data['data'] or not kline_data['data']['klines']:
                    print(f"Warning: No k-line data received for {secid}.", flush=True)
                    #time.sleep(1) # Still sleep to be nice to the API
                    continue

                klines_to_import = []
                for kline_str in kline_data['data']['klines']:
                    timestamp = kline_str.split(',', 1)[0]
                    if timestamp <= latest_db_timestamp:
                        continue
                        
                    parts = kline_str.split(',')
                    # timestamp,open,close,high,low,volume,turnover,amplitude_pct,change_pct,change_amount,turnover_rate_pct
                    klines_to_import.append({
                        "secid": secid,
                        "klt": klt,
                        "timestamp": parts[0],
                        "open": float(parts[1]),
                        "close": float(parts[2]),
                        "high": float(parts[3]),
                        "low": float(parts[4]),
                        "volume": int(parts[5]),
                        "turnover": float(parts[6]),
                        "amplitude_pct": float(parts[7]),
                        "change_pct": float(parts[8]),
                        "change_amount": float(parts[9]),
                        "turnover_rate_pct": float(parts[10])
                    })
                
                if not klines_to_import:
                    print(f"  -> K-line data for {secid} is already up to date. Skipping.", flush=True)
                    #time.sleep(1) # Short sleep before next
                    continue

                sql = """
                INSERT OR IGNORE INTO etf_klines (
                    secid, klt, timestamp, open, close, high, low, volume, turnover, 
                    amplitude_pct, change_pct, change_amount, turnover_rate_pct
                ) VALUES (
                    :secid, :klt, :timestamp, :open, :close, :high, :low, :volume, :turnover, 
                    :amplitude_pct, :change_pct, :change_amount, :turnover_rate_pct
                )
                """
                
                cursor.executemany(sql, klines_to_import)
                conn.commit()
                total_klines_imported += cursor.rowcount
                print(f"  -> Imported {cursor.rowcount} new k-line records for {secid}.", flush=True)

            except subprocess.CalledProcessError as e:
                print(f"Error fetching k-lines for {secid}: {e.stderr}", file=sys.stderr)
            except json.JSONDecodeError as e:
                print(f"Error decoding JSON for {secid}: {e}", file=sys.stderr)
            except sqlite3.OperationalError as e:
                if "no such table" in str(e):
                    print("Error: 'etf_klines' table not found. Please run 'etf_info' command first to initialize the database.", file=sys.stderr)
                    sys.exit(1) # Exit because the table is missing for all subsequent operations
                else:
                    print(f"An unexpected database error occurred for {secid}: {e}", file=sys.stderr)
            except Exception as e:
                print(f"An unexpected error occurred for {secid}: {e}", file=sys.stderr)

            # Be nice to the API server
            #time.sleep(20) 

        print(f"\nFinished processing all ETFs. Total new k-lines imported: {total_klines_imported}", flush=True)

    except sqlite3.Error as e:
        print(f"Database error: {e}", file=sys.stderr)
        if 'conn' in locals() and conn:
            conn.rollback()
        sys.exit(1)
    finally:
        if 'conn' in locals() and conn:
            conn.close()
        print("Script finished.", flush=True)

def check_failed_etfs(db_file, klt):
    """Checks for ETFs that have info but no k-line data for a given klt."""
    print(f"Checking for failed ETF k-line saves for klt={klt}", flush=True)

    try:
        conn = sqlite3.connect(db_file)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        try:
            # 1. Get all ETFs from etf_info and construct secid
            cursor.execute("SELECT SECURITY_CODE, MARKET FROM etf_info")
            all_etfs = cursor.fetchall()
            
            all_secids = set()
            market_id_map = {'SH': '1', 'SZ': '0'}
            for etf in all_etfs:
                market = etf['MARKET']
                security_code = etf['SECURITY_CODE']
                if market in market_id_map:
                    market_id = market_id_map[market]
                    secid = f"{market_id}.{security_code}"
                    all_secids.add(secid)

            print(f"Found {len(all_secids)} ETFs in etf_info.", flush=True)

            # 2. Get all secids from etf_klines for the given klt
            cursor.execute("SELECT DISTINCT secid FROM etf_klines WHERE klt = ?", (klt,))
            saved_etfs = cursor.fetchall()
            saved_secids = {row['secid'] for row in saved_etfs}

            print(f"Found {len(saved_secids)} ETFs with k-lines for klt={klt}.", flush=True)

        except sqlite3.OperationalError as e:
            if "no such table" in str(e):
                print(f"Error: A required table was not found. Please run 'etf_info' and 'etf_klines' first. Details: {e}", file=sys.stderr)
                sys.exit(1)
            else:
                raise

        # 3. Find the difference
        failed_secids = all_secids - saved_secids

        if not failed_secids:
            print("All ETFs have been saved successfully.", flush=True)
        else:
            print(f"\nFound {len(failed_secids)} ETFs that might have failed to save for klt={klt}:", flush=True)
            for secid in sorted(list(failed_secids)):
                print(secid, flush=True)

    except sqlite3.Error as e:
        print(f"Database error: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        if 'conn' in locals() and conn:
            conn.close()
        print("Check finished.", flush=True)


if __name__ == "__main__":
    main()
