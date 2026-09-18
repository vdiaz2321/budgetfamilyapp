#!/bin/bash
# Installs (or updates) the monthly database backup on this Mac.
# Safe to re-run after editing scripts/backup-db.sh.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.budgetfamilyapp.backup.plist"

mkdir -p "$HOME/.local/bin" "$HOME/BudgetBackups" "$HOME/.config/budget-backup" "$HOME/Library/LaunchAgents"
chmod 700 "$HOME/.config/budget-backup"

# The scheduled job runs a copy outside ~/Documents, which macOS blocks
# background jobs from reading.
cp "$HERE/backup-db.sh" "$HOME/.local/bin/budget-backup.sh"
chmod 755 "$HOME/.local/bin/budget-backup.sh"

sed "s|__HOME__|$HOME|g" "$HERE/com.budgetfamilyapp.backup.plist" > "$PLIST"
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "Installed. Runs on the 1st of each month at 9:00."
[ -s "$HOME/.config/budget-backup/db-url" ] || echo "Still needed: save the connection string (docs/backups.md, step 1)."
