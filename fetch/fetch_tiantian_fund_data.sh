#!/bin/bash

#
# Main Data Fetching Script
#
# This script orchestrates the entire data fetching process. Its responsibilities are:
# 1. To define the output directory structure.
# 2. To fetch the list of all industry sectors.
# 3. To iterate through each sector and fetch all the stocks within it.
# 4. To save all the data in a structured way.
#
# It relies on `call_ttjj_api.sh` to handle the low-level API communication.
# It requires `jq` to be installed for JSON processing.

# --- Setup ---
# Define the directory structure for the output data.
OUTPUT_DIR="eastmoney_data"
SECTORS_FILE="${OUTPUT_DIR}/all_sectors.json"
STOCKS_DIR="${OUTPUT_DIR}/stocks"

echo "Starting data fetch..."
# Create the directory structure.
mkdir -p "${STOCKS_DIR}"
echo "Created directory structure in ./${OUTPUT_DIR}"

# --- Functions ---

# Fetches the complete list of all industry sectors.
fetch_all_sectors() {
    echo "Step 1: Fetching all industry sectors..."
    
    # Call the API script to get the first page, which contains the total count.
    local first_page_response
    first_page_response=$(./call_ttjj_api.sh get_sectors 1)
    
    # Extract the total number of sectors from the JSON response.
    local total
    total=$(echo "$first_page_response" | jq '.data.total')

    # Exit if the total count could not be retrieved.
    if [ -z "$total" ] || [ "$total" == "null" ]; then
        echo "Error: Could not retrieve total sector count. Aborting."
        exit 1
    fi

    # Calculate the total number of pages.
    # The page size is hardcoded here because it's defined in the API script.
    local page_size=20
    local num_pages=$(( (total + page_size - 1) / page_size ))
    echo "Found ${total} sectors across ${num_pages} pages."

    # Loop through all pages, fetch the data, and append it to a single JSON array.
    local all_sectors="[]"
    for i in $(seq 1 $num_pages); do
        echo "Fetching sector page $i of $num_pages..."
        local response
        response=$(./call_ttjj_api.sh get_sectors $i)
        
        # Extract the list of sectors ('diff' array) from the response.
        local items
        items=$(echo "$response" | jq '.data.diff')
        # Append the items from the current page to the main array.
        all_sectors=$(echo "$all_sectors" | jq --argjson new_items "$items" '. + $new_items')
    done

    # Save the final combined array to a file.
    echo "$all_sectors" | jq '.' > "$SECTORS_FILE"
    echo "Successfully saved all sector data to ${SECTORS_FILE}"
}

# Fetches the complete list of stocks for a given sector code.
fetch_stocks_for_sector() {
    local sector_code=$1
    local stock_output_file="${STOCKS_DIR}/${sector_code}.json"

    echo "  - Fetching stocks for sector: ${sector_code}"

    # Call the API script to get the first page, which contains the total count.
    local first_page_response
    first_page_response=$(./call_ttjj_api.sh get_stocks "$sector_code" 1)

    # Extract the total number of stocks from the JSON response.
    local total
    total=$(echo "$first_page_response" | jq '.data.total')

    # If no stocks are found, or if there's an error, skip this sector.
    if [ -z "$total" ] || [ "$total" == "null" ]; then
        echo "    Warning: Could not retrieve stock count for sector ${sector_code}. Skipping."
        return
    fi

    # Calculate the total number of pages.
    local page_size=50
    local num_pages=$(( (total + page_size - 1) / page_size ))
    echo "    Found ${total} stocks across ${num_pages} pages."

    # Loop through all pages, fetch the data, and append it to a single JSON array.
    local all_stocks="[]"
    for i in $(seq 1 $num_pages); do
        echo "    Fetching stock page $i of $num_pages..."
        local response
        response=$(./call_ttjj_api.sh get_stocks "$sector_code" $i)
        
        # Extract the list of stocks ('diff' array) from the response.
        local items
        items=$(echo "$response" | jq '.data.diff')
        # Append the items from the current page to the main array.
        all_stocks=$(echo "$all_stocks" | jq --argjson new_items "$items" '. + $new_items')
    done

    # Save the final combined array to a file.
    echo "$all_stocks" | jq '.' > "$stock_output_file"
    echo "    Successfully saved stock data to ${stock_output_file}"
}


# --- Main Execution ---

# 1. Fetch all sectors.
fetch_all_sectors

# 2. Check if the sector file was created successfully.
if [ -f "${SECTORS_FILE}" ]; then
    echo "Step 2: Fetching stocks for each sector..."
    # Read the sector codes from the saved file and loop through them.
    jq -r '.[].f12' "${SECTORS_FILE}" | while IFS= read -r sector_code; do
        fetch_stocks_for_sector "$sector_code"
    done
    echo "All data fetching complete."
else
    # If the sector file wasn't created, something went wrong in the first step.
    echo "Error: Sector file was not created. Cannot fetch stock data."
    exit 1
fi