#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ACTIVITY_PRG="$ROOT_DIR/build/garmin/fuel-guard-activity-logger-fr255.prg"
QUICK_LOG_PRG="$ROOT_DIR/build/garmin/fuel-guard-quick-log-fr255.prg"

for prg in "$ACTIVITY_PRG" "$QUICK_LOG_PRG"; do
  if [[ ! -f "$prg" ]]; then
    echo "Missing PRG: $prg"
    echo "Run: GARMIN_DEVELOPER_KEY=\"\$HOME/.garmin-connectiq/developer_key.der\" ./scripts/build-garmin.sh"
    exit 1
  fi
done

find_garmin_volume() {
  local volume
  for volume in /Volumes/*; do
    [[ -d "$volume/GARMIN/APPS" ]] || continue
    printf '%s\n' "$volume"
    return 0
  done
  return 1
}

GARMIN_VOLUME="${GARMIN_DEVICE_VOLUME:-}"
if [[ -z "$GARMIN_VOLUME" ]]; then
  if ! GARMIN_VOLUME="$(find_garmin_volume)"; then
    echo "Garmin filesystem not found; connect the Forerunner 255 by USB and rerun, or manually copy both build/garmin/*.prg files into the watch GARMIN/APPS folder if macOS does not expose it."
    exit 1
  fi
fi

APP_DIR="$GARMIN_VOLUME/GARMIN/APPS"
if [[ ! -d "$APP_DIR" || ! -w "$APP_DIR" ]]; then
  echo "Garmin app folder is not writable: $APP_DIR"
  echo "Connect the Forerunner 255 as a writable USB volume, then rerun this script."
  exit 1
fi

install_prg() {
  local source="$1"
  local target="$APP_DIR/$(basename "$source")"
  cp "$source" "$target"
  if [[ ! -f "$target" ]]; then
    echo "Install verification failed for $(basename "$source")"
    exit 1
  fi
  echo "Installed: $target"
}

install_prg "$ACTIVITY_PRG"
install_prg "$QUICK_LOG_PRG"

echo "Sideload complete. Safely eject the Garmin device before disconnecting it."
