#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${GARMIN_API_ENDPOINT:-}" ]]; then
  echo "Set GARMIN_API_ENDPOINT to the deployed /api/garmin-log URL."
  exit 1
fi

KEYCHAIN_SERVICE="${FUELGUARD_KEYCHAIN_SERVICE:-FuelGuard Garmin Alpha}"

keychain_secret() {
  local account="$1"
  security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$account" -w 2>/dev/null || true
}

if [[ -z "${GARMIN_BETA_TOKEN:-}" ]]; then
  GARMIN_BETA_TOKEN="$(keychain_secret GARMIN_BETA_TOKEN)"
  if [[ -z "$GARMIN_BETA_TOKEN" ]]; then
    echo "Set GARMIN_BETA_TOKEN or store it in macOS Keychain service '$KEYCHAIN_SERVICE'."
    exit 1
  fi
fi

if [[ -z "${VERCEL_AUTOMATION_BYPASS_SECRET:-}" ]]; then
  VERCEL_AUTOMATION_BYPASS_SECRET="$(keychain_secret VERCEL_AUTOMATION_BYPASS_SECRET)"
fi

EVENT_ID="fg-alpha-test-$(date -u +%Y%m%dT%H%M%SZ)-$RANDOM"
LOGGED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
PAYLOAD="$(printf '{"external_event_id":"%s","logged_at":"%s","type":"fuel","device_id":"fr255-alpha-test"}' "$EVENT_ID" "$LOGGED_AT")"

HTTP_STATUS=""
HTTP_BODY=""

safe_body() {
  local body="$1"
  body="${body//$GARMIN_BETA_TOKEN/[redacted]}"
  if [[ -n "${VERCEL_AUTOMATION_BYPASS_SECRET:-}" ]]; then
    body="${body//$VERCEL_AUTOMATION_BYPASS_SECRET/[redacted]}"
  fi
  printf '%s\n' "$body"
}

send_event() {
  local label="$1"
  local response
  local headers=(
    -H "Content-Type: application/json"
    -H "Authorization: Bearer $GARMIN_BETA_TOKEN"
  )
  if [[ -n "${VERCEL_AUTOMATION_BYPASS_SECRET:-}" ]]; then
    headers+=(-H "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET")
  fi

  response="$(curl -sS -X POST "$GARMIN_API_ENDPOINT" \
    "${headers[@]}" \
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
