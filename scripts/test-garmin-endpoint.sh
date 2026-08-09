#!/usr/bin/env bash
set -euo pipefail

endpoint="${GARMIN_API_ENDPOINT:-https://fuelguardapp.com/api/garmin/log}"
if [[ -z "${GARMIN_DEVICE_TOKEN:-}" ]]; then
  cat >&2 <<'EOF'
Set GARMIN_DEVICE_TOKEN to a device token obtained through the Garmin zero-secret pairing flow.
This testing script never accepts the old beta bearer token or a Vercel bypass secret.
EOF
  exit 1
fi

external_event_id="fg-endpoint-test-$(date +%s)-$RANDOM"
body="{\"external_event_id\":\"$external_event_id\",\"logged_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"type\":\"fuel\",\"device_id\":\"fr255\"}"

tmp_one="$(mktemp)"
tmp_two="$(mktemp)"
cleanup() {
  rm -f "$tmp_one" "$tmp_two"
}
trap cleanup EXIT

send_once() {
  local output="$1"
  curl -sS -o "$output" -w '%{http_code}' \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer ${GARMIN_DEVICE_TOKEN}" \
    --data "$body" \
    "$endpoint"
}

first_status="$(send_once "$tmp_one")"
second_status="$(send_once "$tmp_two")"
first_body="$(sed 's/[[:cntrl:]]/ /g' "$tmp_one")"
second_body="$(sed 's/[[:cntrl:]]/ /g' "$tmp_two")"

printf 'First request HTTP %s: %s\n' "$first_status" "$first_body"
printf 'Duplicate request HTTP %s: %s\n' "$second_status" "$second_body"

if [[ "$first_status" != "200" && "$first_status" != "201" ]]; then
  echo "First endpoint request failed." >&2
  exit 1
fi
if [[ "$second_status" != "200" ]]; then
  echo "Duplicate endpoint request was not accepted idempotently." >&2
  exit 1
fi
if ! grep -q '"duplicate"' "$tmp_two"; then
  echo "Duplicate endpoint response did not report duplicate/idempotent handling." >&2
  exit 1
fi
