#!/usr/bin/env bash
set -euo pipefail

KEYCHAIN_SERVICE="${FUELGUARD_KEYCHAIN_SERVICE:-FuelGuard Garmin Alpha}"

usage() {
  cat <<'USAGE'
Usage:
  scripts/configure-garmin-alpha-local.sh token
  scripts/configure-garmin-alpha-local.sh bypass

Copies the requested private-alpha value from macOS Keychain to the clipboard.
No secret value is printed to Terminal.
USAGE
}

secret_account_for_target() {
  case "${1:-}" in
    token) printf '%s\n' "GARMIN_BETA_TOKEN" ;;
    bypass) printf '%s\n' "VERCEL_AUTOMATION_BYPASS_SECRET" ;;
    *) return 1 ;;
  esac
}

setting_label_for_target() {
  case "$1" in
    token) printf '%s\n' "Garmin beta bearer token" ;;
    bypass) printf '%s\n' "Vercel bypass secret" ;;
  esac
}

target="${1:-}"
if ! account="$(secret_account_for_target "$target")"; then
  usage
  exit 1
fi

secret="$(security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$account" -w 2>/dev/null || true)"
if [[ -z "$secret" ]]; then
  echo "Missing Keychain item: service '$KEYCHAIN_SERVICE', account '$account'."
  exit 1
fi

printf '%s' "$secret" | pbcopy
echo "Copied value for Garmin app setting: $(setting_label_for_target "$target")"
