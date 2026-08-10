#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/build/garmin-public"
VERSION="${GARMIN_PUBLIC_VERSION:-0.5.0}"
DEFAULT_KEY="$HOME/.garmin-connectiq/developer_key.der"
DEVELOPER_KEY="${GARMIN_DEVELOPER_KEY:-$DEFAULT_KEY}"

find_monkeyc() {
  if command -v monkeyc >/dev/null 2>&1; then
    command -v monkeyc
    return 0
  fi
  local config="$HOME/Library/Application Support/Garmin/ConnectIQ/current-sdk.cfg"
  if [[ -f "$config" ]]; then
    local current_sdk
    current_sdk="$(sed -n '1p' "$config" | sed 's:/*$::')"
    if [[ -x "$current_sdk/bin/monkeyc" ]]; then
      printf '%s\n' "$current_sdk/bin/monkeyc"
      return 0
    fi
  fi
  return 1
}

MONKEYC="$(find_monkeyc || true)"
if [[ -z "$MONKEYC" ]]; then
  echo "Could not find the active Connect IQ compiler." >&2
  exit 1
fi
if [[ ! -f "$DEVELOPER_KEY" ]]; then
  echo "A Garmin developer key is required for production packaging." >&2
  exit 1
fi

declare -a DEVICES=(
  fr165 fr165m
  fr245 fr245m
  fr255 fr255m fr255s fr255sm
  fr265 fr265s
  fr945 fr945lte fr955 fr965
  fenix7s fenix7 fenix7x
  fenix7spro fenix7pro fenix7xpro fenix7pronowifi fenix7xpronowifi
  fenix843mm fenix847mm fenix8solar47mm fenix8solar51mm fenix8pro47mm
  epix2 epix2pro42mm epix2pro47mm epix2pro51mm
)

for device in "${DEVICES[@]}"; do
  definition="$HOME/Library/Application Support/Garmin/ConnectIQ/Devices/$device/compiler.json"
  if [[ ! -f "$definition" ]]; then
    echo "Missing Connect IQ device definition: $device" >&2
    exit 1
  fi
  if ! jq -e '.appTypes | any(.type == "watchApp") and any(.type == "datafield")' "$definition" >/dev/null; then
    echo "Target does not support both required app types: $device" >&2
    exit 1
  fi
done

mkdir -p "$OUT_DIR"

scan_package() {
  local package="$1"
  local scan_dir
  local forbidden='(sb_secret_|SUPABASE_SECRET|SUPABASE_SERVICE_ROLE|GARMIN_TOKEN_PEPPER|VERCEL_AUTOMATION_BYPASS_SECRET|developer_key|BEGIN [A-Z ]*PRIVATE KEY|\.env|\.vercel)'
  scan_dir="$(mktemp -d /private/tmp/fuelguard-public-iq.XXXXXX)"
  LC_ALL=C bsdtar -xf "$package" -C "$scan_dir"
  if LC_ALL=C rg -a -l "$forbidden" "$scan_dir" >/dev/null; then
    rm -rf "$scan_dir"
    echo "Public package contains a forbidden secret-like or local-development string: $package" >&2
    exit 1
  fi
  if ! LC_ALL=C rg -a -l -F 'https://fuelguardapp.com' "$scan_dir" >/dev/null; then
    rm -rf "$scan_dir"
    echo "Public package is missing the expected Fuel Guard endpoint: $package" >&2
    exit 1
  fi
  rm -rf "$scan_dir"
}

package_app() {
  local app_dir="$1"
  local output_name="$2"
  local output="$OUT_DIR/$output_name.iq"

  echo "Exporting $output_name $VERSION for ${#DEVICES[@]} verified targets"
  (
    cd "$ROOT_DIR/$app_dir"
    "$MONKEYC" \
      -e \
      -f monkey.jungle \
      -y "$DEVELOPER_KEY" \
      -o "$output" \
      -r \
      -w
  )
  if [[ ! -s "$output" ]]; then
    echo "Production package is missing or empty: $output" >&2
    exit 1
  fi
  scan_package "$output"
}

package_app "garmin/FuelGuard/quick-log" "fuel-guard-quick-log-public-$VERSION"
package_app "garmin/FuelGuard/activity-logger" "fuel-guard-activity-logger-public-$VERSION"

LC_ALL=C shasum -a 256 "$OUT_DIR"/*.iq > "$OUT_DIR/SHA256SUMS.txt"
printf 'Built signed public Connect IQ packages in %s\n' "$OUT_DIR"
cat "$OUT_DIR/SHA256SUMS.txt"
