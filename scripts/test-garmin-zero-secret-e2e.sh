#!/usr/bin/env bash
set -euo pipefail

node "$(dirname "$0")/test-garmin-zero-secret-e2e.mjs"
