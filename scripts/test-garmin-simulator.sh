#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/build/garmin-tests"
DEVICE="fr255"
TEST_TIMEOUT_SECONDS="${GARMIN_TEST_TIMEOUT_SECONDS:-90}"

find_sdk_bin() {
  if [[ -n "${CONNECTIQ_HOME:-}" && -x "$CONNECTIQ_HOME/bin/monkeyc" ]]; then
    printf '%s\n' "$CONNECTIQ_HOME/bin"
    return 0
  fi

  local config="$HOME/Library/Application Support/Garmin/ConnectIQ/current-sdk.cfg"
  if [[ -f "$config" ]]; then
    local current_sdk
    current_sdk="$(sed -n '1p' "$config" | sed 's:/*$::')"
    if [[ -n "$current_sdk" && -x "$current_sdk/bin/monkeyc" ]]; then
      printf '%s\n' "$current_sdk/bin"
      return 0
    fi
  fi

  local sdk_root="$HOME/Library/Application Support/Garmin/ConnectIQ/Sdks"
  if [[ -d "$sdk_root" ]]; then
    local monkeyc
    monkeyc="$(find "$sdk_root" -path '*/bin/monkeyc' -type f -perm -111 | sort -r | head -n 1)"
    if [[ -n "$monkeyc" ]]; then
      dirname "$monkeyc"
      return 0
    fi
  fi

  return 1
}

SDK_BIN="$(find_sdk_bin || true)"
if [[ -z "$SDK_BIN" ]]; then
  echo "Could not find the active Connect IQ SDK bin directory." >&2
  exit 1
fi

MONKEYC="$SDK_BIN/monkeyc"
MONKEYDO="$SDK_BIN/monkeydo"
CONNECTIQ="$SDK_BIN/connectiq"
CONNECTIQ_APP="$SDK_BIN/ConnectIQ.app"

for tool in "$MONKEYC" "$MONKEYDO"; do
  if [[ ! -x "$tool" ]]; then
    echo "Missing executable: $tool" >&2
    exit 1
  fi
done

if [[ -z "${GARMIN_DEVELOPER_KEY:-}" ]]; then
  cat >&2 <<'EOF'
GARMIN_DEVELOPER_KEY is required.

Run:
  export GARMIN_DEVELOPER_KEY="$HOME/.garmin-connectiq/developer_key.der"
  ./scripts/test-garmin-simulator.sh
EOF
  exit 1
fi

if [[ ! -f "$GARMIN_DEVELOPER_KEY" ]]; then
  echo "GARMIN_DEVELOPER_KEY does not point to a file." >&2
  exit 1
fi

DEVICE_DIR="$HOME/Library/Application Support/Garmin/ConnectIQ/Devices/$DEVICE"
if [[ ! -f "$DEVICE_DIR/compiler.json" ]]; then
  echo "Missing Garmin device package for $DEVICE: $DEVICE_DIR/compiler.json" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

# Keep this as a real help invocation so script changes stay grounded in the installed SDK.
"$MONKEYC" --help >/dev/null
"$MONKEYDO" --help >/dev/null
if [[ -x "$CONNECTIQ" ]]; then
  "$CONNECTIQ" --help >/dev/null 2>&1 || true
fi

simulator_pids() {
  pgrep -f "ConnectIQ.app/Contents/MacOS/simulator|ConnectIQ.app/Contents/MacOS/ConnectIQ" 2>/dev/null || true
}

PIDS_BEFORE="$(simulator_pids)"
STARTED_SIMULATOR=0
if [[ -z "$PIDS_BEFORE" ]]; then
  if [[ -d "$CONNECTIQ_APP" ]]; then
    open "$CONNECTIQ_APP" >/dev/null 2>&1 || true
    STARTED_SIMULATOR=1
    for _ in {1..30}; do
      if [[ -n "$(simulator_pids)" ]]; then
        break
      fi
      sleep 1
    done
  fi
fi

cleanup() {
  if [[ "$STARTED_SIMULATOR" == "1" ]]; then
    local pids_after pid
    pids_after="$(simulator_pids)"
    for pid in $pids_after; do
      if ! printf '%s\n' "$PIDS_BEFORE" | grep -qx "$pid"; then
        kill "$pid" >/dev/null 2>&1 || true
      fi
    done
  fi
}
trap cleanup EXIT

if [[ -z "$(simulator_pids)" ]]; then
  echo "Connect IQ simulator is not running. Open the simulator, then rerun: GARMIN_DEVELOPER_KEY=\"$HOME/.garmin-connectiq/developer_key.der\" ./scripts/test-garmin-simulator.sh" >&2
  exit 1
fi

build_test_app() {
  local app_dir="$1"
  local output_name="$2"
  local output="$OUT_DIR/$output_name.prg"

  echo "Building Run No Evil test app: $output_name"
  (
    cd "$ROOT_DIR/$app_dir"
    "$MONKEYC" \
      -t \
      -f monkey.jungle \
      -d "$DEVICE" \
      -l 0 \
      -y "$GARMIN_DEVELOPER_KEY" \
      -o "$output" \
      -w
  )

  if [[ ! -s "$output" ]]; then
    echo "Expected unit-test PRG is missing or empty: $output" >&2
    exit 1
  fi
}

run_tests() {
  local label="$1"
  local prg="$2"
  local log="$OUT_DIR/${label// /-}.log"

  echo "Running Run No Evil tests: $label"
  "$MONKEYDO" "$prg" "$DEVICE" -t >"$log" 2>&1 &
  local test_pid=$!
  local deadline=$((SECONDS + TEST_TIMEOUT_SECONDS))

  while kill -0 "$test_pid" >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      kill "$test_pid" >/dev/null 2>&1 || true
      wait "$test_pid" >/dev/null 2>&1 || true
      echo "$label Run No Evil timed out after ${TEST_TIMEOUT_SECONDS}s" >&2
      cat "$log" >&2 || true
      exit 1
    fi
    sleep 1
  done

  local exit_code=0
  wait "$test_pid" || exit_code=$?

  cat "$log"

  if grep -q "Unhandled Exception" "$log" || grep -q "FAILED" "$log"; then
    echo "$label Run No Evil failed" >&2
    exit 1
  fi

  local summary
  summary="$(grep -Eo 'PASSED \(passed=[0-9]+, failed=[0-9]+, errors=[0-9]+\)' "$log" | tail -n 1 || true)"
  if [[ -z "$summary" ]]; then
    echo "$label Run No Evil did not print a passing summary; monkeydo exit code was $exit_code" >&2
    exit 1
  fi

  local passed failed errors
  passed="$(sed -E 's/.*passed=([0-9]+).*/\1/' <<<"$summary")"
  failed="$(sed -E 's/.*failed=([0-9]+).*/\1/' <<<"$summary")"
  errors="$(sed -E 's/.*errors=([0-9]+).*/\1/' <<<"$summary")"

  if [[ "$failed" != "0" || "$errors" != "0" ]]; then
    echo "$label Run No Evil failed: passed=$passed failed=$failed errors=$errors" >&2
    exit 1
  fi

  echo "$label Run No Evil: passed=$passed failed=$failed errors=$errors"
}

build_test_app "garmin/FuelGuard/quick-log" "fuel-guard-quick-log-fr255-tests"
build_test_app "garmin/FuelGuard/activity-logger" "fuel-guard-activity-logger-fr255-tests"

run_tests "Quick Log" "$OUT_DIR/fuel-guard-quick-log-fr255-tests.prg"
run_tests "Activity Logger" "$OUT_DIR/fuel-guard-activity-logger-fr255-tests.prg"
