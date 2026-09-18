#!/bin/bash
# One-time setup for the monthly backup: asks for the database password,
# saves the connection string to ~/.config/budget-backup/db-url (readable only
# by you), checks it works, and runs the first backup.
#
# Run it again any time the database password is reset.
set -euo pipefail

# The project's Session pooler address (works on home networks without IPv6).
HOST="aws-0-us-east-1.pooler.supabase.com"
USER_NAME="postgres.xgrvrbydzwprmrvsqoiz"
URL_FILE="$HOME/.config/budget-backup/db-url"
PSQL="/opt/homebrew/opt/libpq/bin/psql"

# Up to 3 tries, asking again on a wrong password — exiting on the first miss
# left the user pasting the retry at the shell prompt, in plain sight.
URL=""
for attempt in 1 2 3; do
  read -r -s -p "Paste the database password, then press Return (it won't show): " PASSWORD
  echo
  # A copied password often carries a stray space or line break; drop them.
  PASSWORD="$(printf '%s' "$PASSWORD" | tr -d '[:space:]')"
  if [ -z "$PASSWORD" ]; then
    echo "Nothing was pasted."
    continue
  fi
  # Passwords can contain characters like @ or $ that break a URL; encode them.
  # Passed on stdin so the password never appears in the process list.
  ENCODED="$(printf '%s' "$PASSWORD" | python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.stdin.read(), safe=""))')"
  CANDIDATE="postgresql://$USER_NAME:$ENCODED@$HOST:5432/postgres"
  echo "Checking the password…"
  if PGCONNECT_TIMEOUT=10 "$PSQL" "$CANDIDATE" -tAc "select 1" >/dev/null 2>&1; then
    URL="$CANDIDATE"
    break
  fi
  echo "That password didn't work (a just-reset password can take a minute to start working). Try again."
done
[ -n "$URL" ] || { echo "Nothing saved. Run this again when you have the password."; exit 1; }

mkdir -p "$(dirname "$URL_FILE")"
chmod 700 "$(dirname "$URL_FILE")"
( umask 077; printf '%s\n' "$URL" > "$URL_FILE" )
echo "Password works and is saved."

echo "Running the first backup…"
bash "$HOME/.local/bin/budget-backup.sh"
