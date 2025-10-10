#!/bin/bash

# =============================================================================
# Data Fetching and Storing Script
#
# Author: Gemini
# Date: 2025-09-07
#
# This script fetches market data using call_ttjj_api.sh and stores it
# into the SQLite database (stocks.db).
# =============================================================================

# --- Configuration ---
DB_FILE="stocks.db"
API_SCRIPT="./call_ttjj_api.sh"


# --- Helper Functions ---

# Function to log messages with a timestamp.
log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] - $1"
}

# Function to check for required commands and files.
check_dependencies() {
    log "Checking dependencies..."
    for cmd in jq sqlite3; do
        if ! command -v "$cmd" &> /dev/null; then
            log "Error: Required command '$cmd' is not installed." >&2
            exit 1
        fi
    done

    if [ ! -f "$API_SCRIPT" ]; then
        log "Error: API script '$API_SCRIPT' not found." >&2
        exit 1
    fi

    if [ ! -x "$API_SCRIPT" ]; then
        log "Error: API script '$API_SCRIPT' is not executable. Please run: chmod +x $API_SCRIPT" >&2
        exit 1
    fi

    if [ ! -f "$DB_FILE" ]; then
        log "Error: Database file '$DB_FILE' not found. Please run init_db.sh first." >&2
        exit 1
    fi
    log "All dependencies are satisfied."
}

# --- Core Functions ---

# Fetches all sectors from the API and stores them in the 'sectors' table.
fetch_and_store_sectors() {
    log "Starting to fetch and store sectors..."
    local page1_response
    page1_response=$($API_SCRIPT get_sectors 1)
    if [ -z "$page1_response" ]; then
        log "Error: Failed to get a response from the API for sectors."
        return 1
    fi
    sleep 5

    local total_sectors
    total_sectors=$(echo "$page1_response" | jq '.data.total')
    local page_size=20 # As defined in call_ttjj_api.sh

    if [[ -z "$total_sectors" || "$total_sectors" == "null" ]]; then
        log "Error: Could not determine total number of sectors. Aborting."
        return 1
    fi

    local total_pages=$(( (total_sectors + page_size - 1) / page_size ))
    log "Found $total_sectors sectors across $total_pages pages."

    log "Processing sectors page 1/$total_pages..."
    echo "$page1_response" | jq -c '.data.diff[] | {code: .f12, name: .f14, market: .f13}' | while read -r sector_json; do
        local code name market
        code=$(echo "$sector_json" | jq -r '.code')
        name=$(echo "$sector_json" | jq -r '.name')
        market=$(echo "$sector_json" | jq -r '.market')

        sqlite3 "$DB_FILE" "INSERT OR IGNORE INTO sectors (sector_code, sector_name, market_id) VALUES ('$code', '$name', '$market');"
    done

    for ((p=2; p<=total_pages; p++)); do
        log "Fetching sectors page $p/$total_pages..."
        local response=$($API_SCRIPT get_sectors "$p")
        sleep 5
        
        echo "$response" | jq -c '.data.diff[] | {code: .f12, name: .f14, market: .f13}' | while read -r sector_json; do
            local code name market
            code=$(echo "$sector_json" | jq -r '.code')
            name=$(echo "$sector_json" | jq -r '.name')
            market=$(echo "$sector_json" | jq -r '.market')

            sqlite3 "$DB_FILE" "INSERT OR IGNORE INTO sectors (sector_code, sector_name, market_id) VALUES ('$code', '$name', '$market');"
        done
    done
    log "Finished storing sectors."
}

# Fetches all stocks for every sector and stores them, including the M2M relationship.
fetch_and_store_stocks() {
    log "Starting to fetch and store stocks for all sectors..."
    local sector_codes
    sector_codes=$(sqlite3 "$DB_FILE" "SELECT sector_code FROM sectors;")
    
    for sector_code in $sector_codes; do
        log "Fetching stocks for sector: $sector_code"
        local page1_response
        page1_response=$($API_SCRIPT get_stocks "$sector_code" 1)
        if [ -z "$page1_response" ]; then
            log "Error: Failed to get a response from the API for stocks in sector $sector_code."
            continue
        fi
        sleep 5

        local total_stocks
        total_stocks=$(echo "$page1_response" | jq '.data.total')
        local page_size=50 # As defined in call_ttjj_api.sh

        if [[ -z "$total_stocks" || "$total_stocks" == "null" || "$total_stocks" -eq 0 ]]; then
            log "No stocks found for sector $sector_code, skipping."
            continue
        fi

        local total_pages=$(( (total_stocks + page_size - 1) / page_size ))
        log "Found $total_stocks stocks in sector $sector_code across $total_pages pages."

        log "Processing stocks for sector $sector_code, page 1/$total_pages..."
        echo "$page1_response" | jq -c '.data.diff[] | {code: .f12, name: .f14, market: .f13}' | while read -r stock_json; do
            local stock_code stock_name stock_market
            stock_code=$(echo "$stock_json" | jq -r '.code')
            stock_name=$(echo "$stock_json" | jq -r '.name')
            stock_market=$(echo "$stock_json" | jq -r '.market')

            # Insert stock info
            sqlite3 "$DB_FILE" "INSERT OR IGNORE INTO stocks (stock_code, stock_name, market_id) VALUES ('$stock_code', '$stock_name', '$stock_market');"
            
            # Insert many-to-many relationship
            sqlite3 "$DB_FILE" "INSERT OR IGNORE INTO stock_sectors (stock_id, sector_id) VALUES ((SELECT id FROM stocks WHERE stock_code = '$stock_code'), (SELECT id FROM sectors WHERE sector_code = '$sector_code'));"
        done

        for ((p=2; p<=total_pages; p++)); do
            log "Fetching stocks for sector $sector_code, page $p/$total_pages..."
            local response=$($API_SCRIPT get_stocks "$sector_code" "$p")
            sleep 5

            echo "$response" | jq -c '.data.diff[] | {code: .f12, name: .f14, market: .f13}' | while read -r stock_json; do
                local stock_code stock_name stock_market
                stock_code=$(echo "$stock_json" | jq -r '.code')
                stock_name=$(echo "$stock_json" | jq -r '.name')
                stock_market=$(echo "$stock_json" | jq -r '.market')

                # Insert stock info
                sqlite3 "$DB_FILE" "INSERT OR IGNORE INTO stocks (stock_code, stock_name, market_id) VALUES ('$stock_code', '$stock_name', '$stock_market');"
                
                # Insert many-to-many relationship
                sqlite3 "$DB_FILE" "INSERT OR IGNORE INTO stock_sectors (stock_id, sector_id) VALUES ((SELECT id FROM stocks WHERE stock_code = '$stock_code'), (SELECT id FROM sectors WHERE sector_code = '$sector_code'));"
            done
        done
    done
    log "Finished storing stocks and their sector relationships."
}

# Converts a user-friendly period name (e.g., "daily") to its corresponding klt code.
get_klt_from_period_name() {
    local period_name
    period_name=$(echo "$1" | tr '[:upper:]' '[:lower:]') # make it case-insensitive
    case $period_name in
        daily|d|101) echo "101";;
        weekly|w|102) echo "102";;
        monthly|m|103) echo "103";;
        quarterly|q|104) echo "104";;
        yearly|y|106) echo "106";;
        *) # Return empty for unknown periods
            echo ""
            ;;
    esac
}

# Fetches and stores k-line data for a single security for a given period.
fetch_and_store_klines_for_stock() {
    local secid=$1
    local klt=$2
    local period_name=$3 # for logging

    if [[ -z "$secid" || -z "$klt" || -z "$period_name" ]]; then
        log "Error: Not all arguments provided to fetch_and_store_klines_for_stock."
        return 1
    fi

    log "Fetching $period_name k-line for $secid (klt: $klt)..."
    # lmt=100000 should be enough to get all historical data for any stock
    local response
    response=$($API_SCRIPT get_kline "$secid" "$klt" 100000 "20991231")
    sleep 5

    # First, check if the response is empty
    if [ -z "$response" ]; then
        log "Error: API returned an empty response for klines of $secid."
        return 1
    fi

    # Second, validate if it's proper JSON before trying to parse complex fields
    if ! echo "$response" | jq -e . > /dev/null 2>&1; then
        log "Error: API response for klines of $secid was not valid JSON. The invalid response was: '$response'"
        return 1
    fi

    local klines_count
    klines_count=$(echo "$response" | jq '.data.klines | length')

    if [[ -z "$klines_count" || "$klines_count" == "null" || "$klines_count" -eq 0 ]]; then
        log "No $period_name k-line data returned for $secid."
        return
    fi
    log "Received $klines_count data points for $secid. Storing..."

    # Pipe all SQL commands into a single sqlite3 process for efficiency and transactional integrity.
    {
        echo "BEGIN TRANSACTION;"
        echo "$response" | jq -r '.data.klines[]' | while IFS=',' read -r timestamp open close high low volume turnover amplitude_pct change_pct change_amount turnover_rate_pct; do
            # Generate the SQL statement for each line of data.
            echo "INSERT OR REPLACE INTO klines (secid, klt, timestamp, open, close, high, low, volume, turnover, amplitude_pct, change_pct, change_amount, turnover_rate_pct) VALUES ('$secid', '$klt', '$timestamp', $open, $close, $high, $low, $volume, $turnover, $amplitude_pct, $change_pct, $change_amount, $turnover_rate_pct);"
        done
        echo "COMMIT;"
    } | sqlite3 "$DB_FILE"
    log "Finished storing $period_name k-line data for $secid."
}

# Wrapper function to fetch k-lines for a given period for ALL stocks.
fetch_all_klines_for_period() {
    local klt=$1
    local period_name=$2
    local force_yes=$3

    # If not forced, we need confirmation.
    if [ "$force_yes" != "yes" ]; then
        log "WARNING: This will attempt to fetch $period_name k-line data for ALL stocks in the database."
        log "This process can take several hours to complete and may be rate-limited by the API provider."
        
        # Check if we are in an interactive terminal before trying to read.
        if [[ "$-_" != *i* && -t 0 ]]; then # Check for non-interactive shell
            log "Error: Cannot ask for confirmation in a non-interactive shell (e.g. when running with nohup)." >&2
            log "Please use the '-y' or '--yes' flag to bypass this confirmation prompt." >&2
            return 1 # Abort the function
        fi

        read -p "Are you sure you want to continue? (y/N) " -r response
        if [[ ! "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
            log "Aborted fetching all $period_name k-lines."
            return
        fi
    fi

    log "Starting to fetch all $period_name k-lines..."
    local stocks_info
    stocks_info=$(sqlite3 "$DB_FILE" "SELECT market_id, stock_code FROM stocks;")
    
    echo "$stocks_info" | while IFS='|' read -r market_id stock_code; do
        if [[ -n "$market_id" && -n "$stock_code" ]]; then
            local secid="${market_id}.${stock_code}"
            fetch_and_store_klines_for_stock "$secid" "$klt" "$period_name"
        fi
    done
    log "Finished fetching all $period_name k-lines."
}


# --- Main Execution ---

# Prints a user-friendly guide on how to use the script.
print_usage() {
    echo "Usage: $0 [options] <command> [arguments]"
    echo ""
    echo "A tool to fetch stock market data and store it in a local SQLite database."
    echo ""
    echo "OPTIONS:"
    echo "  -l, --log-file <file>   Redirect all output to the specified log file."
    echo "  -y, --yes               Automatically answer 'yes' to confirmation prompts."
    echo ""
    echo "COMMANDS:"
    echo "  sectors"
    echo "      Fetch and store all market sectors."
    echo "      Example: $0 sectors"
    echo ""
    echo "  stocks"
    echo "      Fetch and store all stocks for the sectors already in the database."
    echo "      Example: $0 stocks"
    echo ""
    echo "  full-sync"
    echo "      A convenient command to run 'sectors' and then 'stocks'."
    echo "      Example: $0 full-sync"
    echo ""
    echo "  klines <period> <secid|--all>"
    echo "      Fetch k-lines for a given period."
    echo "      - Supported Periods: daily, weekly, monthly, quarterly, yearly"
    echo "      - Examples:"
    echo "          $0 klines daily 1.600519"
    echo "          $0 klines weekly 90.BK0433"
    echo "          $0 klines monthly --all"
    echo ""
    echo "  help"
    echo "      Show this help message."
    echo ""
}

main() {
    # --- Argument Parsing for Options ---
    local LOG_FILE=""
    local FORCE_YES="no"

    # This loop handles options like --log-file before processing commands.
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -l|--log-file)
                # If a log file is specified, redirect all output.
                exec &> "$2"
                echo "Logging output to $2"
                shift # past argument
                shift # past value
                ;;
            -y|--yes)
                FORCE_YES="yes"
                shift # past argument
                ;;
            *)
                # Not an option, it must be the command. Break the loop.
                break
                ;;
        esac
    done

    # --- Command Execution ---
    
    # The first step should always be to check dependencies.
    check_dependencies

    local command=$1
    # Show help if no command is provided.
    if [ -z "$command" ]; then
        print_usage
        exit 1
    fi

    # Shift consumes the command argument, so subsequent args can be processed easily.
    shift

    case $command in
        sectors)
            fetch_and_store_sectors
            ;;
        stocks)
            fetch_and_store_stocks
            ;;
        full-sync)
            log "Starting full sync: fetching sectors and then stocks..."
            fetch_and_store_sectors
            fetch_and_store_stocks
            log "Full sync completed."
            ;;
        klines)
            local period_name=$1
            local target=$2
            if [[ -z "$period_name" || -z "$target" ]]; then
                log "Error: 'klines' command requires <period> and <target>." >&2
                log "Usage: $0 klines <period> <secid|--all>" >&2
                exit 1
            fi

            local klt
            klt=$(get_klt_from_period_name "$period_name")
            if [ -z "$klt" ]; then
                log "Error: Invalid period '$period_name'." >&2
                log "Supported periods: daily, weekly, monthly, quarterly, yearly." >&2
                exit 1
            fi

            if [[ "$target" == "--all" || "$target" == "all" ]]; then
                fetch_all_klines_for_period "$klt" "$period_name" "$FORCE_YES"
            else
                # Assume any other argument is a secid
                fetch_and_store_klines_for_stock "$target" "$klt" "$period_name"
            fi
            ;;
        help|--help|-h)
            print_usage
            ;;
        *)
            log "Error: Unknown command '$command'" >&2
            print_usage
            exit 1
            ;;
    esac

    log "Script finished."
}

# Call the main function with all passed arguments
main "$@"