#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${GARMIN_PUBLIC_VERSION:-0.5.2}"
DEFAULT_RELEASE_ROOT="$HOME/Documents/Codex/FuelGuard/releases/garmin-public"
RELEASE_ROOT="${FUELGUARD_PUBLIC_RELEASE_ROOT:-$DEFAULT_RELEASE_ROOT}"
SOURCE_DIR="$ROOT_DIR/build/garmin-public"
DEST_DIR="$RELEASE_ROOT/$VERSION"

case "$RELEASE_ROOT" in
  /tmp|/tmp/*|/private/tmp|/private/tmp/*)
    echo "Refusing to export public Garmin packages to temporary storage." >&2
    exit 1
    ;;
esac

"$ROOT_DIR/scripts/build-garmin-public.sh"
mkdir -p "$DEST_DIR"

for package in \
  "fuel-guard-quick-log-public-$VERSION.iq" \
  "fuel-guard-activity-logger-public-$VERSION.iq"; do
  if [[ ! -s "$SOURCE_DIR/$package" ]]; then
    echo "Missing source package: $SOURCE_DIR/$package" >&2
    exit 1
  fi
  cp "$SOURCE_DIR/$package" "$DEST_DIR/$package"
done

LC_ALL=C shasum -a 256 "$DEST_DIR"/*.iq > "$DEST_DIR/SHA256SUMS.txt"
printf 'Exported public Garmin release candidate to %s\n' "$DEST_DIR"
cat "$DEST_DIR/SHA256SUMS.txt"
