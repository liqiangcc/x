#!/bin/bash

# =============================================================================
# Database Initialization Script
#
# Author: Gemini
# Date: 2025-09-07
#
# This script creates a new SQLite database and initializes it with the schema
# defined in the specified schema file.
# =============================================================================

# --- Configuration ---
# The name of the database file to be created.
DB_FILE="stocks.db"
# The path to the SQL schema file.
SCHEMA_FILE="database_schema.sql"


# --- Pre-flight Checks ---

# Check if the sqlite3 command-line tool is installed.
if ! command -v sqlite3 &> /dev/null; then
    echo "Error: sqlite3 command not found." >&2
    echo "Please install SQLite3 before running this script." >&2
    exit 1
fi

# Check if the schema file exists.
if [ ! -f "$SCHEMA_FILE" ]; then
    echo "Error: Schema file not found at '$SCHEMA_FILE'" >&2
    echo "Please ensure the schema file exists in the current directory." >&2
    exit 1
fi

# Check if the database file already exists to prevent accidental data loss.
if [ -f "$DB_FILE" ]; then
    echo "Error: Database file '$DB_FILE' already exists." >&2
    echo "If you want to re-initialize, please remove the existing file manually: rm $DB_FILE" >&2
    exit 1
fi


# --- Initialization ---

echo "Creating and initializing database: '$DB_FILE'..."

# Use sqlite3 to create the database and execute the schema script.
# The '<' operator redirects the content of the schema file into the sqlite3 command.
sqlite3 "$DB_FILE" < "$SCHEMA_FILE"

# Check the exit code of the last command to confirm success.
if [ $? -eq 0 ]; then
    echo "Database '$DB_FILE' initialized successfully." 
    echo "You can now connect to it using: sqlite3 $DB_FILE"
else
    echo "Error: Database initialization failed." >&2
    # Clean up the potentially empty or corrupt database file on failure.
    rm -f "$DB_FILE"
    exit 1
fi

exit 0
