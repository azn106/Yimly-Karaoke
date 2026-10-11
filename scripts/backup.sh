#!/bin/bash
# Yimly Backup Script
# Usage: ./scripts/backup.sh

set -e

BACKUP_DIR="./backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/yimly_backup_$TIMESTAMP.tar.gz"

echo "[Backup] Starting backup at $TIMESTAMP"

mkdir -p "$BACKUP_DIR"

WAS_RUNNING=false
if docker compose -f compose.yaml ps --status running --services 2>/dev/null | grep -q "^yimly$"; then
    WAS_RUNNING=true
fi

cleanup() {
    local exit_code=$?
    if [ "$WAS_RUNNING" = true ]; then
        echo "[Backup] Ensuring Yimly container is restarted..."
        docker compose -f compose.yaml start yimly >/dev/null 2>&1 || true
    fi
    exit $exit_code
}

trap cleanup EXIT

# 1. Stop container to ensure DB consistency if running
if [ "$WAS_RUNNING" = true ]; then
    echo "[Backup] Stopping Yimly container for consistent backup..."
    docker compose -f compose.yaml stop yimly
fi

# 2. Perform backup
# We back up the data and media directories based on the mounts defined in compose.yaml
if tar -czf "$BACKUP_FILE" ./data ./media; then
    echo "[Backup] Successfully created backup: $BACKUP_FILE"
    # Optional: Verify backup integrity
    if tar -tzf "$BACKUP_FILE" >/dev/null; then
        echo "[Backup] Integrity verification passed."
    else
        echo "[Backup] Integrity verification FAILED!"
        rm -f "$BACKUP_FILE"
        exit 1
    fi
else
    echo "[Backup] Backup failed!"
    exit 1
fi

echo "[Backup] Backup process complete."
