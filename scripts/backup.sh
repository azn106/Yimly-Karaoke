#!/bin/bash
# Yimly Backup Script
# Usage: ./scripts/backup.sh

set -e

BACKUP_DIR="./backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/yimly_backup_$TIMESTAMP.tar.gz"

echo "[Backup] Starting backup at $TIMESTAMP"

mkdir -p "$BACKUP_DIR"

# 1. Stop container to ensure DB consistency
echo "[Backup] Stopping Yimly container for consistent backup..."
docker compose stop yimly

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
        docker compose start yimly
        exit 1
    fi
else
    echo "[Backup] Backup failed!"
    docker compose start yimly
    exit 1
fi

# 3. Restart container
echo "[Backup] Restarting Yimly container..."
docker compose start yimly

echo "[Backup] Backup process complete."
