#!/bin/zsh

# Double-click this file in Finder to start Capitall locally.
cd -- "$(dirname "$0")" || exit 1

echo "Starting Capitall…"
echo "Open http://localhost:3000 after the server says Ready."
echo "Press Control + C in this window when you are finished."
echo ""

npm run dev
