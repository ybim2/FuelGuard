#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${GARMIN_PUBLIC_VERSION:-0.5.4}"
RELEASE_ROOT="${FUELGUARD_PUBLIC_RELEASE_ROOT:-$HOME/Documents/Codex/FuelGuard/releases/garmin-public}"
RELEASE_DIR="$RELEASE_ROOT/$VERSION"
FR255_PART_NUMBER="006-B3992-00"

case "$RELEASE_ROOT" in
  /tmp|/tmp/*|/private/tmp|/private/tmp/*)
    echo "Refusing to export Forerunner 255 candidates to temporary storage." >&2
    exit 1
    ;;
esac

extract_candidate() {
  local package_name="$1"
  local candidate_name="$2"
  local package="$RELEASE_DIR/$package_name"
  local member="$FR255_PART_NUMBER/$package_name"
  member="${member%.iq}.prg"

  if [[ ! -s "$package" ]]; then
    echo "Missing persistent public package: $package" >&2
    exit 1
  fi
  if ! LC_ALL=C bsdtar -tf "$package" | grep -Fxq "$member"; then
    echo "The public package does not contain the expected Forerunner 255 binary: $member" >&2
    exit 1
  fi
  LC_ALL=C bsdtar -xOf "$package" "$member" > "$RELEASE_DIR/$candidate_name"
  if [[ ! -s "$RELEASE_DIR/$candidate_name" ]]; then
    echo "Extracted Forerunner 255 candidate is empty: $candidate_name" >&2
    exit 1
  fi
}

extract_candidate \
  "fuel-guard-quick-log-public-$VERSION.iq" \
  "fuel-guard-quick-log-public-$VERSION-fr255.prg"
extract_candidate \
  "fuel-guard-activity-logger-public-$VERSION.iq" \
  "fuel-guard-activity-logger-public-$VERSION-fr255.prg"

LC_ALL=C shasum -a 256 "$RELEASE_DIR"/*-fr255.prg > "$RELEASE_DIR/FR255-SHA256SUMS.txt"
printf 'Exported exact Forerunner 255 candidates from the signed public packages to %s\n' "$RELEASE_DIR"
cat "$RELEASE_DIR/FR255-SHA256SUMS.txt"
