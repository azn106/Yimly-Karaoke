#!/bin/bash
# Test script for Yimly Backup/Restore
# Usage: ./scripts/verify_backup.sh

set -e

# Setup test environment
TEST_ROOT="./test_backup_env"
TEST_DATA="$TEST_ROOT/data"
TEST_MEDIA="$TEST_ROOT/media"
BACKUP_DIR="$TEST_ROOT/backups"

echo "[Test] Setting up test environment..."
mkdir -p "$TEST_DATA" "$TEST_MEDIA" "$BACKUP_DIR"
echo "test_db_content" > "$TEST_DATA/yimly.db"
echo "test_media_file" > "$TEST_MEDIA/test.mp3"

# Perform backup
echo "[Test] Backing up..."
tar -czf "$BACKUP_DIR/test_backup.tar.gz" -C "$TEST_ROOT" data media

# Simulate restore
echo "[Test] Restoring into separate location..."
RESTORE_DIR="$TEST_ROOT/restore"
mkdir -p "$RESTORE_DIR"
tar -xzf "$BACKUP_DIR/test_backup.tar.gz" -C "$RESTORE_DIR"

# Verify
if [ -f "$RESTORE_DIR/data/yimly.db" ] && [ -f "$RESTORE_DIR/media/test.mp3" ]; then
    echo "[Test] Backup/Restore verification PASSED."
    # Cleanup
    rm -rf "$TEST_ROOT"
    exit 0
else
    echo "[Test] Backup/Restore verification FAILED!"
    exit 1
fi
