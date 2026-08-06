#!/usr/bin/env bash
set -euo pipefail

WORKSPACE_ROOT="${FUEL_GUARD_WORKSPACE_ROOT:-/Users/theo/Documents/Codex/FuelGuard}"
MAIN="$WORKSPACE_ROOT/main"
ACTIVE="$WORKSPACE_ROOT/worktree-active"

if [ ! -d "$ACTIVE" ]; then
  echo "No active worktree exists." >&2
  exit 1
fi
branch="$(git -C "$ACTIVE" branch --show-current)"
if [ -z "$branch" ]; then
  echo "Active worktree is detached; refusing to remove it." >&2
  exit 1
fi
if [ -n "$(git -C "$ACTIVE" status --short)" ]; then
  echo "Active worktree has uncommitted changes. Commit or preserve them before finishing." >&2
  git -C "$ACTIVE" status --short >&2
  exit 1
fi
if ! git -C "$ACTIVE" rev-parse --verify "origin/$branch" >/dev/null 2>&1; then
  echo "Branch has no origin/$branch ref. Push the feature branch before finishing." >&2
  exit 1
fi
if ! git -C "$ACTIVE" merge-base --is-ancestor HEAD "origin/$branch"; then
  echo "Local branch has commits that are not pushed to origin/$branch." >&2
  exit 1
fi

git -C "$MAIN" fetch origin --prune
if ! git -C "$MAIN" merge-base --is-ancestor "origin/$branch" origin/main; then
  echo "Branch $branch is not merged into origin/main. Not removing worktree-active." >&2
  exit 1
fi

git -C "$MAIN" worktree remove "$ACTIVE"
git -C "$MAIN" switch main
git -C "$MAIN" pull --ff-only origin main
"$MAIN/scripts/workspace-status.sh" > "$WORKSPACE_ROOT/STATUS.md" || true
echo "Finished merged branch $branch. worktree-active removed."
