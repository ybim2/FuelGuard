#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <branch-slug>" >&2
  echo "Example: $0 web-first-tab-rhythm" >&2
  exit 2
fi
slug="$1"
case "$slug" in
  codex/*) branch="$slug" ;;
  *) branch="codex/$slug" ;;
esac
WORKSPACE_ROOT="${FUEL_GUARD_WORKSPACE_ROOT:-/Users/theo/Documents/Codex/FuelGuard}"
MAIN="$WORKSPACE_ROOT/main"
ACTIVE="$WORKSPACE_ROOT/worktree-active"

if [ ! -d "$MAIN/.git" ]; then
  echo "Canonical main is missing: $MAIN" >&2
  exit 1
fi
if [ -n "$(git -C "$MAIN" status --short)" ]; then
  echo "Canonical main is not clean. Refusing to start a task." >&2
  git -C "$MAIN" status --short >&2
  exit 1
fi
git -C "$MAIN" fetch origin --prune
git -C "$MAIN" switch main
git -C "$MAIN" pull --ff-only origin main

if [ -e "$ACTIVE" ]; then
  if [ -d "$ACTIVE/.git" ] || [ -f "$ACTIVE/.git" ]; then
    echo "worktree-active already exists. Finish or remove the current worktree before starting another task." >&2
    git -C "$ACTIVE" status --short --branch >&2 || true
    exit 1
  fi
  echo "worktree-active path exists but is not a Git worktree: $ACTIVE" >&2
  exit 1
fi

git -C "$MAIN" worktree add -b "$branch" "$ACTIVE" origin/main
"$ACTIVE/scripts/workspace-status.sh" > "$WORKSPACE_ROOT/STATUS.md"
echo "Started $branch at $ACTIVE"
