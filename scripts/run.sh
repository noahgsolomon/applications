#!/bin/bash

# Path to your migration script
SCRIPT="add-github-company.ts"

# Maximum execution time for the migration script (in seconds)
TIMEOUT_DURATION=600 # 10 minutes

# Interval between retries (in seconds)
RETRY_INTERVAL=60 # 1 minute

# Infinite loop to keep the migration running
while true; do
  echo "[$(date)] Starting migration script..."

  # Run the migration script using Bun with a timeout
  # If the script runs longer than TIMEOUT_DURATION, it will be terminated
  timeout "$TIMEOUT_DURATION" bun run "$SCRIPT" >/dev/null 2>&1

  # Capture the exit code of the migration script
  EXIT_CODE=$?

  echo "[$(date)] Migration script exited with code $EXIT_CODE."

  # Wait for 1 minute before restarting the migration script
  sleep "$RETRY_INTERVAL"
done
