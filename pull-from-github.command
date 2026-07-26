#!/bin/bash

PROJECT_DIR="/Users/m3mac2024/Documents/budgetfamilyapp"

cd "$PROJECT_DIR" || exit 1

echo "Checking Capitall repository..."

if [ -n "$(git status --porcelain -- . ':(exclude)pull-from-github.command')" ]; then
  echo
  echo "Pull stopped: this folder has uncommitted or untracked changes."
  echo "Review them in Claude Code or Codex, then commit/push before pulling."
  echo
  git status --short
  echo
  read -n 1 -s -r -p "Press any key to close..."
  echo
  exit 1
fi

echo "Pulling the latest committed changes from GitHub..."
git pull --ff-only origin main

echo
echo "Pull complete."
read -n 1 -s -r -p "Press any key to close..."
echo
