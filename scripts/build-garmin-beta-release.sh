#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${GARMIN_BETA_VERSION:-0.4.1}"
DEFAULT_RELEASE_ROOT="$HOME/Documents/Codex/2026-08-06/fuelguard-garmin-activity-and-quick-log/build/garmin-beta"
RELEASE_ROOT="${FUELGUARD_RELEASE_ROOT:-$DEFAULT_RELEASE_ROOT}"

case "$RELEASE_ROOT" in
  /tmp|/tmp/*|/private/tmp|/private/tmp/*)
    printf 'Refusing to export Garmin beta packages to temporary storage: %s\n' "$RELEASE_ROOT" >&2
    exit 1
    ;;
esac

"$ROOT_DIR/scripts/build-garmin-beta.sh"

SOURCE_DIR="$ROOT_DIR/build/garmin-beta"
DEST_DIR="$RELEASE_ROOT/$VERSION"
mkdir -p "$DEST_DIR"

copy_package() {
  local name="$1"
  local source="$SOURCE_DIR/$name"
  local dest="$DEST_DIR/$name"

  if [[ ! -s "$source" ]]; then
    printf 'Expected source package is missing or empty: %s\n' "$source" >&2
    exit 1
  fi

  cp "$source" "$dest"

  if [[ ! -s "$dest" ]]; then
    printf 'Exported package is missing or empty: %s\n' "$dest" >&2
    exit 1
  fi

  printf '%s\n' "$dest"
}

quick_log_path="$(copy_package fuel-guard-quick-log-beta.iq)"
activity_logger_path="$(copy_package fuel-guard-activity-logger-beta.iq)"

checksum_file="$DEST_DIR/SHA256SUMS.txt"
LC_ALL=C shasum -a 256 "$quick_log_path" "$activity_logger_path" > "$checksum_file"

printf 'Exported Fuel Guard Garmin beta packages:\n'
printf '  Quick Log: %s\n' "$quick_log_path"
printf '  Activity Logger: %s\n' "$activity_logger_path"
printf '  SHA-256: %s\n' "$checksum_file"
