#!/bin/bash
# Monthly backup of the budget database (the app's data plus the login rows it
# points at) to a plain SQL file on this Mac.
#
# Why plain SQL: it restores into ANY Postgres — a new Supabase project, Neon,
# a local install — with one `psql` command, and it's readable in a text
# editor. See docs/backups.md for setup and restore.
#
# The connection string holds the database password, so it lives OUTSIDE the
# repo in ~/.config/budget-backup/db-url (chmod 600) — never in .env.local.
#
# Backups go to ~/BudgetBackups, not ~/Documents: macOS blocks scheduled jobs
# from writing to Documents/Desktop/Downloads without Full Disk Access.

set -euo pipefail
# Backups hold financial data and login rows: readable by this user only.
umask 077

URL_FILE="$HOME/.config/budget-backup/db-url"
OUT_DIR="$HOME/BudgetBackups"
KEEP=12   # months of backups to keep
PG_DUMP="/opt/homebrew/opt/libpq/bin/pg_dump"

notify() {
  /usr/bin/osascript -e "display notification \"$1\" with title \"Budget backup\"" >/dev/null 2>&1 || true
}

fail() {
  echo "$(date '+%F %T') FAILED: $1" >&2
  notify "FAILED — $1"
  exit 1
}

[ -x "$PG_DUMP" ] || fail "pg_dump not found (brew install libpq)"
[ -s "$URL_FILE" ] || fail "no connection string in $URL_FILE (see docs/backups.md)"

mkdir -p "$OUT_DIR"
STAMP="$(date +%F)"
TMP="$OUT_DIR/.budget-$STAMP.sql.gz.partial"
OUT="$OUT_DIR/budget-$STAMP.sql.gz"

# Two parts in one file, in restore order:
#  1. The login rows (auth.users + auth.identities), data only — every
#     profile points at one, so the app's data can't load without them. A new
#     Supabase project already has these tables; it just needs the rows.
#  2. The app's own schema and data (public), with DROP-then-CREATE so it
#     restores over an existing copy too.
DB_URL="$(cat "$URL_FILE")"
if ! {
  "$PG_DUMP" "$DB_URL" --data-only --table=auth.users --table=auth.identities --no-owner --no-privileges &&
  "$PG_DUMP" "$DB_URL" --schema=public --no-owner --no-privileges --clean --if-exists
} | gzip > "$TMP"; then
  rm -f "$TMP"
  fail "pg_dump could not reach the database"
fi

# A dump missing the key tables means something went wrong even if pg_dump didn't say so.
for table in auth.users public.transactions; do
  # Read via <(…), not a pipe: grep -q stops early, and under pipefail the
  # cut-off gzip would make a good backup look broken.
  grep -q "^COPY ${table/./\\.} " <(gzip -dc "$TMP") || { rm -f "$TMP"; fail "backup is missing $table"; }
done

mv "$TMP" "$OUT"

# Keep the newest $KEEP backups, delete older ones.
ls -1t "$OUT_DIR"/budget-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do rm -f "$old"; done

SIZE="$(du -h "$OUT" | cut -f1 | tr -d ' ')"
echo "$(date '+%F %T') OK: $OUT ($SIZE)"

# Second copy in iCloud Drive, so a backup survives losing this Mac. Same
# 12-file limit. A failure here doesn't undo the local backup — it's reported
# on its own so a silent iCloud problem can't hide.
ICLOUD_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/Budget Backups"
if mkdir -p "$ICLOUD_DIR" 2>/dev/null && cp "$OUT" "$ICLOUD_DIR/"; then
  ls -1t "$ICLOUD_DIR"/budget-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do rm -f "$old"; done
  echo "$(date '+%F %T') OK: copied to iCloud Drive/Budget Backups"
  notify "Saved $(basename "$OUT") ($SIZE) — on this Mac and in iCloud"
else
  echo "$(date '+%F %T') WARNING: saved on this Mac, but the iCloud copy failed" >&2
  notify "Saved on this Mac, but the iCloud copy FAILED"
fi
