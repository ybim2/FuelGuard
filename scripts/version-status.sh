#!/usr/bin/env bash
set -euo pipefail

WORKSPACE_ROOT="${FUEL_GUARD_WORKSPACE_ROOT:-/Users/theo/Documents/Codex/FuelGuard}"
MAIN="$WORKSPACE_ROOT/main"
ACTIVE="$WORKSPACE_ROOT/worktree-active"
REGISTRY="$ACTIVE/release-versions.json"

json_field() {
  node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); const path=process.argv[2].split('.'); let v=data; for (const key of path) v=v && v[key]; console.log(v ?? 'unknown');" "$REGISTRY" "$1"
}

manifest_version() {
  node -e "const fs=require('fs'); const m=fs.readFileSync(process.argv[1],'utf8').match(/<iq:application[^>]*\sversion=\"([^\"]+)\"/); console.log(m ? m[1] : 'unknown');" "$1"
}

main_sha="$(git -C "$MAIN" rev-parse HEAD 2>/dev/null || echo unknown)"
origin_sha="$(git -C "$MAIN" rev-parse origin/main 2>/dev/null || echo unknown)"
active_branch="$(git -C "$ACTIVE" branch --show-current 2>/dev/null || echo None)"
active_status="$(git -C "$ACTIVE" status --short 2>/dev/null || true)"
main_status="$(git -C "$MAIN" status --short 2>/dev/null || true)"
web_version="$(json_field web.version)"
quick_version="$(json_field garmin_quick_log.version)"
activity_version="$(json_field garmin_activity_logger.version)"
quick_manifest="$(manifest_version "$ACTIVE/garmin/quick-log/manifest.beta.xml")"
activity_manifest="$(manifest_version "$ACTIVE/garmin/activity-logger/manifest.beta.xml")"

echo "Fuel Guard version status"
echo "Workspace root: $WORKSPACE_ROOT"
echo "Current main SHA: $main_sha"
echo "Origin main SHA: $origin_sha"
if [ "$main_sha" = "$origin_sha" ] && [ -z "$main_status" ]; then
  echo "Main synchronized with origin/main: yes"
else
  echo "Main synchronized with origin/main: no"
fi
echo "Web version: $web_version"
echo "Quick Log version: $quick_version (manifest: $quick_manifest)"
echo "Activity Logger version: $activity_version (manifest: $activity_manifest)"
echo "Active branch: $active_branch"
echo "Active worktree path: $ACTIVE"
if [ -z "$active_status" ]; then
  echo "Active worktree clean: yes"
else
  echo "Active worktree clean: no"
  printf '%s\n' "$active_status"
fi
echo "Latest permanent Garmin release folders:"
find "$WORKSPACE_ROOT/releases/garmin" -maxdepth 1 -mindepth 1 -type d -print 2>/dev/null | sort -V || true

if [ "$quick_version" != "$quick_manifest" ] || [ "$activity_version" != "$activity_manifest" ]; then
  echo "ERROR: release-versions.json does not match Garmin beta manifest versions." >&2
  exit 1
fi
