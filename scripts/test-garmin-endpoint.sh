#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${GARMIN_API_ENDPOINT:-}" ]]; then
  echo "Set GARMIN_API_ENDPOINT to the deployed /api/garmin-log URL."
  exit 1
fi

if [[ -z "${GARMIN_BETA_TOKEN:-}" ]]; then
  echo "Set GARMIN_BETA_TOKEN to the private alpha bearer token."
  exit 1
fi

EVENT_ID="fg-alpha-test-$(date -u +%Y%m%dT%H%M%SZ)-$RANDOM"
LOGGED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
PAYLOAD="$(printf '{"external_event_id":"%s","logged_at":"%s","type":"fuel","device_id":"fr255-alpha-test"}' "$EVENT_ID" "$LOGGED_AT")"

HTTP_STATUS=""
HTTP_BODY=""

safe_body() {
  local body="$1"
  printf '%s\n' "${body//$GARMIN_BETA_TOKEN/[redacted]}"
}

send_event() {
  local label="$1"
  local response
  response="$(curl -sS -X POST "$GARMIN_API_ENDPOINT" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $GARMIN_BETA_TOKEN" \
    --data "$PAYLOAD" \
    -w '\n%{http_code}')"
  HTTP_STATUS="${response##*$'\n'}"
  HTTP_BODY="${response%$'\n'*}"

  echo "$label HTTP status: $HTTP_STATUS"
  echo "$label response:"
  safe_body "$HTTP_BODY"
}

json_result() {
  node -e 'const input = process.argv[1] || "{}"; try { const data = JSON.parse(input); console.log(data.result || ""); } catch { console.log(""); }' "$1"
}

send_event "First request"
FIRST_RESULT="$(json_result "$HTTP_BODY")"

if [[ ! "$HTTP_STATUS" =~ ^20[01]$ || ! "$FIRST_RESULT" =~ ^(ok|duplicate|already_recorded)$ ]]; then
  echo "First request did not create or acknowledge the test event."
  exit 1
fi

send_event "Second request"
SECOND_RESULT="$(json_result "$HTTP_BODY")"

if [[ "$HTTP_STATUS" != "200" || ! "$SECOND_RESULT" =~ ^(duplicate|already_recorded)$ ]]; then
  echo "Second request was not acknowledged as an idempotent duplicate."
  exit 1
fi

echo "Endpoint idempotency check passed for event: $EVENT_ID"
