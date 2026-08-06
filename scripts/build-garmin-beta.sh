#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/build/garmin-beta"
DEVICE="fr255"

find_monkeyc() {
  if command -v monkeyc >/dev/null 2>&1; then
    command -v monkeyc
    return 0
  fi

  if [[ -n "${CONNECTIQ_HOME:-}" && -x "$CONNECTIQ_HOME/bin/monkeyc" ]]; then
    printf '%s\n' "$CONNECTIQ_HOME/bin/monkeyc"
    return 0
  fi

  local config="$HOME/Library/Application Support/Garmin/ConnectIQ/current-sdk.cfg"
  if [[ -f "$config" ]]; then
    local current_sdk
    current_sdk="$(sed -n '1p' "$config" | sed 's:/*$::')"
    if [[ -n "$current_sdk" && -x "$current_sdk/bin/monkeyc" ]]; then
      printf '%s\n' "$current_sdk/bin/monkeyc"
      return 0
    fi
  fi

  local sdk_root="$HOME/Library/Application Support/Garmin/ConnectIQ/Sdks"
  if [[ -d "$sdk_root" ]]; then
    find "$sdk_root" -path '*/bin/monkeyc' -type f -perm -111 | sort -r | head -n 1
    return 0
  fi

  return 1
}

MONKEYC="$(find_monkeyc || true)"
if [[ -z "$MONKEYC" ]]; then
  cat >&2 <<'EOF'
Could not find monkeyc.

Install Garmin Connect IQ SDK Manager, or set CONNECTIQ_HOME to the active SDK
directory so CONNECTIQ_HOME/bin/monkeyc exists.
EOF
  exit 1
fi

if [[ -z "${GARMIN_DEVELOPER_KEY:-}" ]]; then
  cat >&2 <<'EOF'
GARMIN_DEVELOPER_KEY is required.

Set it to the Connect IQ developer key before packaging:
  export GARMIN_DEVELOPER_KEY=/absolute/path/to/developer_key.der
  scripts/build-garmin-beta.sh

This script never generates, copies, or commits the developer key.
EOF
  exit 1
fi

if [[ ! -f "$GARMIN_DEVELOPER_KEY" ]]; then
  printf 'GARMIN_DEVELOPER_KEY does not point to a file: %s\n' "$GARMIN_DEVELOPER_KEY" >&2
  exit 1
fi

DEVICE_DIR="$HOME/Library/Application Support/Garmin/ConnectIQ/Devices/$DEVICE"
if [[ ! -f "$DEVICE_DIR/compiler.json" ]]; then
  cat >&2 <<EOF
Missing Garmin device package for $DEVICE.

The Connect IQ compiler requires:
  $DEVICE_DIR/compiler.json

Open Garmin Connect IQ SDK Manager, go to the Devices tab, install the
Forerunner 255 / product ID $DEVICE package, then rerun:
  export GARMIN_DEVELOPER_KEY="\$HOME/.garmin-connectiq/developer_key.der"
  scripts/build-garmin-beta.sh
EOF
  exit 1
fi

mkdir -p "$OUT_DIR"

echo "Using monkeyc: $MONKEYC"
"$MONKEYC" --help >/dev/null

package_app() {
  local app_dir="$1"
  local output_name="$2"
  local output="$OUT_DIR/$output_name.iq"

  echo "Packaging $output_name as a signed Connect IQ beta app"
  (
    cd "$ROOT_DIR/$app_dir"
    "$MONKEYC" \
      -e \
      -f monkey.beta.jungle \
      -y "$GARMIN_DEVELOPER_KEY" \
      -o "$output" \
      -r \
      -w
  )

  if [[ ! -s "$output" ]]; then
    printf 'Expected beta package is missing or empty: %s\n' "$output" >&2
    exit 1
  fi

  if LC_ALL=C grep -aE '(\.env|\.vercel|developer_key|\.der|\.pem|GARMIN_BETA_TOKEN|VERCEL_AUTOMATION_BYPASS_SECRET|SUPABASE_SECRET|sb_secret_)' "$output" >/dev/null; then
    printf 'Package contains a forbidden local, key, token, or secret string: %s\n' "$output" >&2
    exit 1
  fi
}

package_app "garmin/activity-logger" "fuel-guard-activity-logger-beta"
package_app "garmin/quick-log" "fuel-guard-quick-log-beta"

echo "Built Garmin beta IQ packages in $OUT_DIR"
