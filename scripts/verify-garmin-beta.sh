#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

./scripts/test-garmin-simulator.sh
./scripts/build-garmin.sh
./scripts/build-garmin-beta.sh
node --test tests/*.test.js
git diff --check

secret_scan_pattern='(sb_secret_[A-Za-z0-9_=-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|-----BEGIN [A-Z ]*PRIVATE KEY-----|GARMIN_BETA_TOKEN=[A-Za-z0-9+/_=-]{16,}|VERCEL_AUTOMATION_BYPASS_SECRET=[A-Za-z0-9+/_=-]{16,}|SUPABASE_SECRET_KEY=[A-Za-z0-9+/_=-]{16,})'
if git grep -I -n -E "$secret_scan_pattern" -- ':!build/**' ':!.vercel/**' ':!*.png' ':!*.iq' ':!*.prg' >/tmp/fuelguard-garmin-secret-scan.txt; then
  echo "Tracked-files secret scan found a forbidden secret-like value:" >&2
  cat /tmp/fuelguard-garmin-secret-scan.txt >&2
  exit 1
fi
rm -f /tmp/fuelguard-garmin-secret-scan.txt

declare -a required_outputs=(
  "build/garmin/fuel-guard-activity-logger-fr255.prg"
  "build/garmin/fuel-guard-quick-log-fr255.prg"
  "build/garmin-beta/fuel-guard-activity-logger-beta.iq"
  "build/garmin-beta/fuel-guard-quick-log-beta.iq"
)

for output in "${required_outputs[@]}"; do
  if [[ ! -s "$output" ]]; then
    echo "Required build output is missing or empty: $output" >&2
    exit 1
  fi
done

echo "Tracked-files secret scan passed"
echo "GARMIN BETA PRE-UPLOAD GATE PASSED"
