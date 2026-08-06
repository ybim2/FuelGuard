#!/usr/bin/env bash
set -euo pipefail

WORKSPACE_ROOT="${FUEL_GUARD_WORKSPACE_ROOT:-/Users/theo/Documents/Codex/FuelGuard}"
STATUS="$WORKSPACE_ROOT/STATUS.md"
MAIN="$WORKSPACE_ROOT/main"
ACTIVE="$WORKSPACE_ROOT/worktree-active"

echo "Fuel Guard workspace status"
echo "Canonical main: $MAIN"
echo "Main commit: $(git -C "$MAIN" rev-parse HEAD 2>/dev/null || echo unknown)"
echo "Production source: origin/main"
if [ -d "$ACTIVE" ]; then
  echo "Active worktree: $ACTIVE"
  echo "Active branch: $(git -C "$ACTIVE" branch --show-current 2>/dev/null || echo unknown)"
  if [ -z "$(git -C "$ACTIVE" status --short 2>/dev/null || true)" ]; then
    echo "Active worktree clean: yes"
  else
    echo "Active worktree clean: no"
    git -C "$ACTIVE" status --short
  fi
else
  echo "Active worktree: None"
  echo "Active branch: None"
fi
echo ""
echo "Version details:"
"$(dirname "$0")/version-status.sh"
echo ""
echo "Human status file: $STATUS"
