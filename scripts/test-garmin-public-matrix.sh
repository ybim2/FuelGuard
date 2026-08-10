#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/build/garmin-public-matrix"
DEFAULT_KEY="$HOME/.garmin-connectiq/developer_key.der"
DEVELOPER_KEY="${GARMIN_DEVELOPER_KEY:-$DEFAULT_KEY}"
TEST_TIMEOUT_SECONDS="${GARMIN_TEST_TIMEOUT_SECONDS:-90}"

SDK_CONFIG="$HOME/Library/Application Support/Garmin/ConnectIQ/current-sdk.cfg"
SDK_ROOT="$(sed -n '1p' "$SDK_CONFIG" | sed 's:/*$::')"
MONKEYC="$SDK_ROOT/bin/monkeyc"
MONKEYDO="$SDK_ROOT/bin/monkeydo"
CONNECTIQ_APP="$SDK_ROOT/bin/ConnectIQ.app"

if [[ ! -x "$MONKEYC" || ! -x "$MONKEYDO" ]]; then
  echo "The active Connect IQ compiler and simulator runner are required." >&2
  exit 1
fi
if [[ ! -f "$DEVELOPER_KEY" ]]; then
  echo "A Garmin developer key is required for simulator matrix testing." >&2
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
if [[ -n "${GARMIN_TEST_DEVICES:-}" ]]; then
  # Intentional word splitting: callers provide a space-delimited product-ID list.
  DEVICES=(${GARMIN_TEST_DEVICES})
fi
TEST_APPS="${GARMIN_TEST_APPS:-both}"

mkdir -p "$OUT_DIR"

simulator_pids() {
  pgrep -f "ConnectIQ.app/Contents/MacOS/simulator|ConnectIQ.app/Contents/MacOS/ConnectIQ" 2>/dev/null || true
}

PIDS_BEFORE="$(simulator_pids)"
STARTED_SIMULATOR=0
if [[ -z "$PIDS_BEFORE" ]]; then
  open "$CONNECTIQ_APP" >/dev/null 2>&1
  STARTED_SIMULATOR=1
  for _ in {1..30}; do
    [[ -n "$(simulator_pids)" ]] && break
    sleep 1
  done
fi

cleanup() {
  if [[ "$STARTED_SIMULATOR" == "1" ]]; then
    local pid
    for pid in $(simulator_pids); do
      if ! printf '%s\n' "$PIDS_BEFORE" | grep -qx "$pid"; then
        kill "$pid" >/dev/null 2>&1 || true
      fi
    done
  fi
}
trap cleanup EXIT

run_one() {
  local device="$1"
  local app_dir="$2"
  local label="$3"
  local slug="$4"
  local prg="$OUT_DIR/$slug-$device-tests.prg"
  local log="$OUT_DIR/$slug-$device.log"

  echo "[$device] Building and testing $label"
  (
    cd "$ROOT_DIR/$app_dir"
    "$MONKEYC" -t -f monkey.jungle -d "$device" -l 0 -y "$DEVELOPER_KEY" -o "$prg" -w
  )

  local attempt
  for attempt in 1 2; do
    "$MONKEYDO" "$prg" "$device" -t >"$log" 2>&1 &
    local test_pid=$!
    local deadline=$((SECONDS + TEST_TIMEOUT_SECONDS))
    local timed_out=0
    while kill -0 "$test_pid" >/dev/null 2>&1; do
      if (( SECONDS >= deadline )); then
        kill "$test_pid" >/dev/null 2>&1 || true
        wait "$test_pid" >/dev/null 2>&1 || true
        timed_out=1
        break
      fi
      sleep 1
    done

    local exit_code=0
    if [[ "$timed_out" == "0" ]]; then
      wait "$test_pid" || exit_code=$?
    fi

    local summary
    summary="$(grep -Eo 'PASSED \(passed=[0-9]+, failed=[0-9]+, errors=[0-9]+\)' "$log" | tail -n 1 || true)"
    if [[ -n "$summary" && "$summary" == *"failed=0, errors=0"* ]]; then
      printf '%s\t%s\t%s\n' "$device" "$label" "$summary" >> "$OUT_DIR/RESULTS.tsv"
      return
    fi
    if [[ "$attempt" == "1" ]]; then
      echo "[$device] $label simulator run did not complete; retrying once" >&2
      sleep 2
    else
      echo "[$device] $label failed after retry; monkeydo exit code was $exit_code" >&2
      cat "$log" >&2 || true
      exit 1
    fi
  done
}

if [[ "${GARMIN_MATRIX_APPEND:-0}" != "1" ]]; then
  : > "$OUT_DIR/RESULTS.tsv"
fi
for device in "${DEVICES[@]}"; do
  if [[ "$TEST_APPS" == "both" || "$TEST_APPS" == "quick-log" ]]; then
    run_one "$device" "garmin/FuelGuard/quick-log" "Quick Log" "quick-log"
  fi
  if [[ "$TEST_APPS" == "both" || "$TEST_APPS" == "activity-logger" ]]; then
    run_one "$device" "garmin/FuelGuard/activity-logger" "Activity Logger" "activity-logger"
  fi
done

echo "Garmin public target simulator matrix passed"
cat "$OUT_DIR/RESULTS.tsv"
